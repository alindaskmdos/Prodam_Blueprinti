package blueprints.app;

import blueprints.analysis.DetectorRegistry;
import blueprints.analysis.Issues;
import blueprints.analysis.MethodAnalysis;
import blueprints.analysis.ProjectAnalysis;
import blueprints.blocks.AstToBlocks;
import blueprints.fixes.Refactoring;
import blueprints.fixes.RefactoringRegistry;
import blueprints.model.Block;
import blueprints.model.Issue;
import blueprints.model.Span;
import blueprints.source.LoadedProject;
import blueprints.source.TreeBuilder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Снимок проекта для ответов по контракту: Analysis (проблемы с blockId, метрики), ProjectTree с complexity/issueCount,
 * MethodView. blockId проблемы — самый глубокий блок метода, чей span содержит span проблемы (decisions.md).
 */
final class ProjectView {
    record Metrics(String methodId, String complexity, int lines, int maxNesting) {}

    record AnalysisDto(int version, int n, List<Issue> issues, List<Metrics> metrics) {}

    record MethodView(String methodId, String signature, String complexity, Block root) {}

    /** MutationResult; method — только для PUT blocks (null не сериализуется). */
    record Mutation(int version, String fileText, MethodView method, ProjectDto.TreeDto tree, AnalysisDto analysis) {}

    private final LoadedProject project;
    private final ProjectAnalysis analysis;
    private final Map<String, Block> trees = new LinkedHashMap<>();
    private final List<Issue> issues;
    private final Map<String, String> files;

    ProjectView(LoadedProject project) {
        this.project = project;
        this.analysis = ProjectAnalysis.of(project.files());
        this.files = RunController.texts(project);
        this.issues = DetectorRegistry.defaults().run(analysis).stream().map(this::withBlockId).toList();
    }

    AnalysisDto analysis(int version) {
        List<Metrics> metrics = analysis.methods().stream()
                .map(m -> new Metrics(m.id(), m.complexity().toString(), m.lines(), m.maxNesting())).toList();
        return new AnalysisDto(version, (int) Issues.DEFAULT_N, issues, metrics);
    }

    ProjectDto.TreeDto tree(int version) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        issues.forEach(i -> counts.merge(i.methodId(), 1, Integer::sum));
        List<TreeBuilder.PackageNode> packages = TreeBuilder.build(project).stream().map(p -> new TreeBuilder.PackageNode(p.name(),
                p.files().stream().map(f -> new TreeBuilder.FileNode(f.path(), f.classes().stream().map(c -> new TreeBuilder.ClassNode(
                        c.name(), c.kind(), c.span(), c.fields(), methods(c.constructors(), counts), methods(c.methods(), counts)))
                        .toList())).toList())).toList();
        return new ProjectDto.TreeDto(version, packages);
    }

    private List<TreeBuilder.Method> methods(List<TreeBuilder.Method> ms, Map<String, Integer> counts) {
        return ms.stream().map(m -> {
            MethodAnalysis a = analysis.method(m.id());
            return new TreeBuilder.Method(m.id(), m.name(), m.signature(), a != null ? a.complexity().toString() : null,
                    counts.getOrDefault(m.id(), 0));
        }).toList();
    }

    /** Вид метода с id проблем в блоках или null, если метода нет (или файл не разобран). */
    MethodView method(String methodId) {
        Block root = tree(methodId);
        if (root == null) return null;
        Map<String, List<String>> byBlock = new LinkedHashMap<>();
        issues.forEach(i -> byBlock.computeIfAbsent(i.blockId(), k -> new ArrayList<>()).add(i.id()));
        return new MethodView(methodId, root.fields().get("signature"),
                analysis.method(methodId).complexity().toString(), withIssues(root, byBlock));
    }

    private Block tree(String methodId) {
        return trees.computeIfAbsent(methodId, id -> {
            MethodAnalysis m = analysis.method(id);
            return m == null ? null : AstToBlocks.convert(m.declaration(), id, m.file());
        });
    }

    private Issue withBlockId(Issue i) {
        Block root = tree(i.methodId());
        String blockId = root == null || i.span() == null ? i.methodId() : innermost(root, i.span()).id();
        return new Issue(i.id(), i.rule(), i.severity(), i.confidence(), i.source(), i.span(), i.methodId(), blockId,
                i.message(), i.recommendation(), i.complexity(), fixes(i));
    }

    /**
     * id фиксов реестра, применимых к проблеме (canApply); при confidence=low — пусто (контракт).
     * ponytail: canApply на каждый снимок, без кэша — кэшировать по версии, если анализ станет медленным.
     */
    private List<String> fixes(Issue i) {
        if (!"high".equals(i.confidence())) return List.of();
        return RefactoringRegistry.defaults().refactorings().stream()
                .filter(r -> canApply(r, i.id())).map(Refactoring::id).toList();
    }

    private boolean canApply(Refactoring r, String target) {
        try {
            return r.canApply(files, target);
        } catch (RuntimeException e) {
            return false; // сломанный фикс не должен ронять анализ
        }
    }

    /** Спуск в первого ребёнка, чей span содержит s. ponytail: два оператора на одной строке — берётся первый. */
    private static Block innermost(Block b, Span s) {
        for (List<Block> slot : b.slots().values()) {
            for (Block c : slot) {
                Span cs = c.span();
                if (cs != null && cs.startLine() <= s.startLine() && s.endLine() <= cs.endLine()) return innermost(c, s);
            }
        }
        return b;
    }

    private static Block withIssues(Block b, Map<String, List<String>> byBlock) {
        Map<String, List<Block>> slots = new LinkedHashMap<>();
        b.slots().forEach((name, list) -> slots.put(name, list.stream().map(c -> withIssues(c, byBlock)).toList()));
        return new Block(b.id(), b.kind(), b.fields(), slots, b.span(), byBlock.getOrDefault(b.id(), List.of()), b.collapsed());
    }
}
