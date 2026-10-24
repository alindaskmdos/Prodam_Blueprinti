package blueprints.app;

import blueprints.analysis.PmdDetector;
import blueprints.runner.Runner;
import blueprints.source.LoadWarning;
import blueprints.source.LoadedProject;
import blueprints.source.ProjectExporter;
import blueprints.source.ProjectLoader;
import blueprints.testing.TestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
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
        LoadedProject loaded = ProjectLoader.load(ups);
        String ruleset = pmdRuleset(ups, loaded.root());
        if (ruleset != null) {
            try {
                PmdDetector.validate(ruleset);
            } catch (PmdDetector.InvalidRulesetException e) {
                // битый конфиг не мешает загрузке: стандартный набор + предупреждение
                List<LoadWarning> warnings = new ArrayList<>(loaded.warnings());
                warnings.add(new LoadWarning("IGNORED_FILE", PmdConfigController.PATH, e.getMessage() + " — используется стандартный набор"));
                loaded = new LoadedProject(loaded.root(), loaded.files(), warnings, loaded.testFiles(), loaded.mainClasses());
                ruleset = null;
            }
        }
        var s = store.create(loaded, ruleset);
        return ResponseEntity.status(201).body(ProjectDto.of(s));
    }

    /** Текст {@code .blueprints/pmd-ruleset.xml} из загрузки (файл или запись zip под отрезанной обёрткой root) или null. */
    static String pmdRuleset(List<ProjectLoader.Upload> ups, String root) throws IOException {
        String want = root + PmdConfigController.PATH;
        for (ProjectLoader.Upload u : ups) {
            String low = u.name().toLowerCase();
            if (!low.endsWith(".zip") && !low.endsWith(".jar")) {
                if (clean(u.name()).equals(want)) return new String(u.data(), StandardCharsets.UTF_8);
                continue;
            }
            try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(u.data()))) {
                for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
                    if (clean(e.getName()).equals(want)) return new String(z.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        return null;
    }

    /** Как ProjectLoader.normalize для уже принятого загрузчиком пути: «\» → «/», без пустых сегментов и «.». */
    private static String clean(String name) {
        return Arrays.stream(name.replace('\\', '/').split("/")).filter(x -> !x.isEmpty() && !x.equals("."))
                .collect(Collectors.joining("/"));
    }

    @GetMapping("/{id}")
    ProjectDto get(@PathVariable String id) {
        return ProjectDto.of(store.get(id));
    }

    @GetMapping("/{id}/tree")
    ProjectDto.TreeDto tree(@PathVariable String id) {
        var s = store.get(id);
        return new ProjectView(s).tree(s.version());
    }

    @GetMapping("/{id}/methods/{methodId}/blocks")
    ProjectView.MethodView blocks(@PathVariable String id, @PathVariable String methodId) {
        ProjectView.MethodView m = new ProjectView(store.get(id)).method(methodId);
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

    /** n — размер входа для «≈ операций» (§8.4); n < 1 -> 400 INVALID_REQUEST. */
    @GetMapping("/{id}/analysis")
    ProjectView.AnalysisDto analysis(@PathVariable String id, @RequestParam(defaultValue = "10000") int n) {
        if (n < 1) throw new ApiException(400, "INVALID_REQUEST", "n должно быть ≥ 1: " + n);
        var s = store.get(id);
        return new ProjectView(s, n).analysis(s.version());
    }

    @GetMapping("/{id}/export")
    ResponseEntity<byte[]> export(@PathVariable String id, @RequestParam String format,
                                  @RequestParam(defaultValue = "true") boolean includeSettings,
                                  @RequestParam(required = false) String mainClass) {
        var s = store.get(id);
        if (format.equals("jar")) return file(id + ".jar", jar(s.content(), mainClass));
        if (!format.equals("zip")) throw new ApiException(400, "INVALID_REQUEST", "format: zip или jar");
        byte[] zip = ProjectExporter.zip(s.content(), includeSettings);
        if (includeSettings && s.pmdRuleset() != null) {
            zip = withEntry(zip, s.content().root() + PmdConfigController.PATH, s.pmdRuleset().getBytes(StandardCharsets.UTF_8));
        }
        return file(id + ".zip", zip);
    }

    /** Копия zip с ещё одной записью в конце. */
    static byte[] withEntry(byte[] zip, String path, byte[] data) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip)); ZipOutputStream out = new ZipOutputStream(bos)) {
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) {
                out.putNextEntry(new ZipEntry(e.getName()));
                in.transferTo(out);
                out.closeEntry();
            }
            out.putNextEntry(new ZipEntry(path));
            out.write(data);
            out.closeEntry();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bos.toByteArray();
    }

    /** Jar из чистого кода (§11): исходники без tests/ и .blueprints/, без seed; ошибки компиляции — 422 COMPILE_ERROR. */
    static byte[] jar(LoadedProject p, String mainClass) {
        Map<String, String> sources = TestContext.javaSources(RunController.texts(p));
        sources.keySet().removeIf(k -> k.startsWith(".blueprints/"));
        Runner.JarResult r = Runner.jar(sources, RunController.chooseMain(sources, mainClass));
        if (r.jar() == null) {
            String why = r.diagnostics().stream().map(d -> RunController.compileError(d, sources))
                    .map(e -> e.file() + ":" + e.line() + ": " + e.message()).collect(Collectors.joining("\n"));
            throw new ApiException(422, "COMPILE_ERROR", "проект не компилируется: " + why);
        }
        return r.jar();
    }

    private static ResponseEntity<byte[]> file(String name, byte[] body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(body);
    }
}
