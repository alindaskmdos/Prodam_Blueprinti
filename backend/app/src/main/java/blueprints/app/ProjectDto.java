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

    public record TreeDto(int version, List<TreeBuilder.PackageNode> packages) {}

    static ProjectDto of(ProjectStore.Stored s) {
        LoadedProject c = s.content();
        return new ProjectDto(s.id(), s.version(),
                c.files().stream().map(f -> new FileDto(f.path(), f.pkg())).toList(),
                c.warnings(), TestImporter.tests(c.testFiles()), c.mainClasses());
    }
}
