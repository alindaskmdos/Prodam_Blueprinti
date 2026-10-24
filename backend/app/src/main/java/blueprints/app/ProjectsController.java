package blueprints.app;

import blueprints.source.ProjectExporter;
import blueprints.source.ProjectLoader;
import blueprints.source.TreeBuilder;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/projects")
class ProjectsController {
    record FileText(String path, String text, int version) {}

    private final ProjectStore store;

    ProjectsController(ProjectStore store) {
        this.store = store;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<ProjectDto> upload(@RequestParam("files") List<MultipartFile> files, HttpServletRequest req) throws IOException {
        // getParameterValues, а не List<String>: Spring режет одиночное значение по запятым
        String[] paths = req.getParameterValues("paths");
        if (paths != null && paths.length != files.size()) {
            throw new ApiException(400, "INVALID_REQUEST", "paths и files должны быть одной длины");
        }
        List<ProjectLoader.Upload> ups = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            String name = paths != null ? paths[i] : files.get(i).getOriginalFilename();
            if (name == null || name.isBlank()) throw new ApiException(400, "INVALID_REQUEST", "у файла нет имени");
            ups.add(new ProjectLoader.Upload(name, files.get(i).getBytes()));
        }
        var s = store.create(ProjectLoader.load(ups));
        return ResponseEntity.status(201).body(ProjectDto.of(s));
    }

    @GetMapping("/{id}")
    ProjectDto get(@PathVariable String id) {
        return ProjectDto.of(store.get(id));
    }

    @GetMapping("/{id}/tree")
    ProjectDto.TreeDto tree(@PathVariable String id) {
        var s = store.get(id);
        return new ProjectDto.TreeDto(s.version(), TreeBuilder.build(s.content()));
    }

    @GetMapping("/{id}/methods/{methodId}/blocks")
    ProjectView.MethodView blocks(@PathVariable String id, @PathVariable String methodId) {
        ProjectView.MethodView m = new ProjectView(store.get(id).content()).method(methodId);
        if (m == null) throw new ApiException(404, "NOT_FOUND", "метод не найден: " + methodId);
        return m;
    }

    @GetMapping("/{id}/files")
    FileText file(@PathVariable String id, @RequestParam String path) {
        var s = store.get(id);
        return s.content().files().stream().filter(f -> f.path().equals(path)).findFirst()
                .map(f -> new FileText(path, f.text(), s.version()))
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "файл не найден: " + path));
    }

    /** ponytail: параметр n не читается — ops считаются при n = 10 000 (Issues.DEFAULT_N), это и отдаётся в n. */
    @GetMapping("/{id}/analysis")
    ProjectView.AnalysisDto analysis(@PathVariable String id) {
        var s = store.get(id);
        return new ProjectView(s.content()).analysis(s.version());
    }

    @GetMapping("/{id}/export")
    ResponseEntity<byte[]> export(@PathVariable String id, @RequestParam String format,
                                  @RequestParam(defaultValue = "true") boolean includeSettings) {
        var s = store.get(id);
        if (format.equals("jar")) throw new ApiException(501, "INTERNAL", "экспорт .jar пока не реализован");
        if (!format.equals("zip")) throw new ApiException(400, "INVALID_REQUEST", "format: zip или jar");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + id + ".zip\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(ProjectExporter.zip(s.content(), includeSettings));
    }
}
