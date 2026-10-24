package blueprints.app;

import blueprints.blocks.AstToBlocks;
import blueprints.blocks.BlocksToJava;
import blueprints.blocks.InvalidNodeException;
import blueprints.blocks.MethodLocator;
import blueprints.blocks.NodeValidator;
import blueprints.model.Block;
import blueprints.source.LoadException;
import blueprints.source.LoadedProject;
import blueprints.source.ProjectLoader;
import blueprints.source.SourceFile;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Правки (§5, §12): PUT blocks — новое дерево метода → код + анализ; PUT files — новый текст файла → блоки + анализ. */
@RestController
@RequestMapping("/api/projects/{id}")
class EditController {
    record BlocksRequest(Integer version, Block root) {}

    record FileRequest(Integer version, String text) {}

    private final ProjectStore store;

    EditController(ProjectStore store) {
        this.store = store;
    }

    @PutMapping("/methods/{methodId}/blocks")
    ProjectView.Mutation putBlocks(@PathVariable String id, @PathVariable String methodId, @RequestBody BlocksRequest req) {
        if (req.version() == null || req.root() == null) throw new ApiException(400, "INVALID_REQUEST", "нужны version и root");
        // id корня — всегда methodId из пути: от него строятся id новых нод в ошибках
        Block root = new Block(methodId, req.root().kind(), req.root().fields(), req.root().slots(), req.root().span(),
                req.root().issues(), req.root().collapsed());
        String[] path = new String[1];
        int[] line = new int[1];
        var s = store.update(id, req.version(), p -> {
            for (SourceFile f : p.files()) {
                ParseResult<CompilationUnit> r = parse(f.text());
                CompilationUnit cu = r.isSuccessful() ? r.getResult().orElse(null) : null;
                Optional<CallableDeclaration<?>> decl = cu == null ? Optional.empty() : MethodLocator.find(cu, methodId);
                if (decl.isEmpty()) continue;
                NodeValidator.validate(root, AstToBlocks.convert(decl.get(), methodId, f.path()));
                String text;
                try {
                    text = BlocksToJava.replaceMethod(f.text(), decl.get(), root);
                } catch (InvalidNodeException e) {
                    throw e;
                } catch (IllegalArgumentException e) {
                    throw new InvalidNodeException(methodId, e.getMessage());
                }
                // страховка: проверка нод не пропустила бы ошибку, но код без разбора в проект не попадает
                if (!parse(text).isSuccessful()) throw ApiException.parseError("сгенерированный код не разбирается", methodId, null);
                path[0] = f.path();
                line[0] = decl.get().getBegin().orElseThrow().line;
                return replace(p, f, text);
            }
            throw new ApiException(404, "NOT_FOUND", "метод не найден: " + methodId);
        });
        ProjectView view = new ProjectView(s.content());
        ProjectView.MethodView method = view.method(methodId);
        // сигнатура переименовала метод: под старым id теперь другой метод (или никакого) — вида метода нет
        if (method != null && method.root().span().startLine() != line[0]) method = null;
        return new ProjectView.Mutation(s.version(), text(s.content(), path[0]), method, view.tree(s.version()), view.analysis(s.version()));
    }

    @PutMapping("/files")
    ProjectView.Mutation putFile(@PathVariable String id, @RequestParam String path, @RequestBody FileRequest req) {
        if (req.version() == null || req.text() == null) throw new ApiException(400, "INVALID_REQUEST", "нужны version и text");
        var s = store.update(id, req.version(), p -> {
            SourceFile f = p.files().stream().filter(x -> x.path().equals(path)).findFirst()
                    .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "файл не найден: " + path));
            ParseResult<CompilationUnit> r = parse(req.text());
            if (!r.isSuccessful() || r.getResult().isEmpty()) {
                var problem = r.getProblems().isEmpty() ? null : r.getProblems().get(0);
                Integer at = problem == null ? null : problem.getLocation()
                        .flatMap(t -> t.getBegin().getRange()).map(x -> x.begin.line).orElse(null);
                throw ApiException.parseError(problem == null ? "ошибка разбора" : problem.getMessage(), null, at);
            }
            return replace(p, f, req.text());
        });
        ProjectView view = new ProjectView(s.content());
        return new ProjectView.Mutation(s.version(), req.text(), null, view.tree(s.version()), view.analysis(s.version()));
    }

    private static ParseResult<CompilationUnit> parse(String text) {
        return new JavaParser(new ParserConfiguration().setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)).parse(text);
    }

    /**
     * Проект с новым текстом файла — повторной загрузкой {@link ProjectLoader} (пакет, предупреждения, mainClasses,
     * дубликаты FQN → LoadException 422 DUPLICATE_FQN, версия не растёт). Неизменённые файлы — исходные байты.
     */
    private static LoadedProject replace(LoadedProject p, SourceFile old, String text) {
        byte[] bytes = text.equals(old.text()) ? old.content() : text.getBytes(StandardCharsets.UTF_8);
        List<ProjectLoader.Upload> ups = new ArrayList<>();
        for (SourceFile f : p.files()) ups.add(new ProjectLoader.Upload(p.root() + f.path(), f == old ? bytes : f.content()));
        p.testFiles().forEach((path, data) -> ups.add(new ProjectLoader.Upload(p.root() + path, data)));
        // загрузчик заново ищет общую папку-обёртку: при root "" и общей верхней папке (её при загрузке держали
        // проигнорированные файлы, README.md рядом с src/) файл-заглушка в корне (не .java — пропускается) не даёт её отрезать.
        // Заглушка бывает только у проектов с проигнорированными файлами, т.е. ниже лимита MAX_FILES
        if (p.root().isEmpty() && sharedTop(ups)) ups.add(new ProjectLoader.Upload(".blueprints-root", new byte[0]));
        try {
            return ProjectLoader.load(ups);
        } catch (LoadException e) {
            // у правок превышение лимита — 422 (413 только у загрузки, решение людей); прочее — как при загрузке
            if (e.code().equals("LIMIT_EXCEEDED")) throw new ApiException(422, "LIMIT_EXCEEDED", e.getMessage());
            throw e;
        }
    }

    private static boolean sharedTop(List<ProjectLoader.Upload> ups) {
        return ups.stream().map(u -> u.name().indexOf('/') < 0 ? "" : u.name().substring(0, u.name().indexOf('/')))
                .distinct().count() == 1 && ups.get(0).name().contains("/");
    }

    private static String text(LoadedProject p, String path) {
        return p.files().stream().filter(f -> f.path().equals(path)).findFirst().orElseThrow().text();
    }
}
