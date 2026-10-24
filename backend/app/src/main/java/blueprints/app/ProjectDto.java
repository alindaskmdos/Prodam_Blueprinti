package blueprints.app;

import blueprints.source.LoadedProject;
import blueprints.source.LoadWarning;
import blueprints.source.TreeBuilder;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** DTO по contract/openapi.yaml (Project, ProjectFile, TestCase, ProjectTree). */
public record ProjectDto(
        String id, int version, List<FileDto> files, List<LoadWarning> warnings,
        List<TestCaseDto> tests, List<String> mainClasses) {

    public record FileDto(String path, @JsonProperty("package") String pkg) {}

    /** expected может быть null и тогда выводится как null (nullable в контракте). */
    public record TestCaseDto(
            String name, String type, String stdin, String mode,
            @JsonInclude(JsonInclude.Include.ALWAYS) String expected,
            List<Integer> ignoreLines, String source) {}

    public record TreeDto(int version, List<PackageDto> packages) {}

    public record PackageDto(String name, List<TreeFileDto> files) {}

    public record TreeFileDto(String path, List<ClassDto> classes) {}

    /** ClassNode контракта: имена-ключевые слова Java (extends, implements) — через @JsonProperty; null-поля не пишутся. */
    public record ClassDto(String name, String kind, String fqn, TreeBuilder.Span span, TreeBuilder.Span headerSpan,
                           TreeBuilder.Pos headerStart, TreeBuilder.Pos headerEnd, List<String> annotations, List<String> modifiers,
                           String typeParams, @JsonProperty("extends") String extendsText,
                           @JsonProperty("implements") List<String> implementsTypes, List<TreeBuilder.Field> fields,
                           List<MethodDto> constructors, List<MethodDto> methods) {
        static ClassDto of(TreeBuilder.ClassNode c) {
            return new ClassDto(c.name(), c.kind(), c.fqn(), c.span(), c.headerSpan(), c.headerStart(), c.headerEnd(),
                    c.annotations(), c.modifiers(), c.typeParams(), c.extendsText(), c.implementsTypes(), c.fields(),
                    c.constructors().stream().map(MethodDto::of).toList(), c.methods().stream().map(MethodDto::of).toList());
        }
    }

    /** MethodNode контракта; throws — через @JsonProperty. */
    public record MethodDto(String id, String name, String signature, String complexity, int issueCount, TreeBuilder.Span span,
                            TreeBuilder.Span headerSpan, TreeBuilder.Pos headerStart, TreeBuilder.Pos headerEnd,
                            List<String> annotations, List<String> modifiers, String typeParams, String returnType,
                            List<TreeBuilder.Param> params, @JsonProperty("throws") List<String> thrown) {
        static MethodDto of(TreeBuilder.Method m) {
            return new MethodDto(m.id(), m.name(), m.signature(), m.complexity(), m.issueCount(), m.span(), m.headerSpan(),
                    m.headerStart(), m.headerEnd(), m.annotations(), m.modifiers(), m.typeParams(), m.returnType(), m.params(),
                    m.thrown());
        }
    }

    static TreeDto tree(int version, List<TreeBuilder.PackageNode> packages) {
        return new TreeDto(version, packages.stream().map(p -> new PackageDto(p.name(), p.files().stream()
                .map(f -> new TreeFileDto(f.path(), f.classes().stream().map(ClassDto::of).toList())).toList())).toList());
    }

    static ProjectDto of(ProjectStore.Stored s) {
        LoadedProject c = s.content();
        return new ProjectDto(s.id(), s.version(),
                c.files().stream().map(f -> new FileDto(f.path(), f.pkg())).toList(),
                c.warnings(), TestImporter.tests(c.testFiles()), c.mainClasses());
    }
}
