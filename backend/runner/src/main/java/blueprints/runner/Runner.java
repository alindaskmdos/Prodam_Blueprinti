package blueprints.runner;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Компиляция (javax.tools, в процессе сервера) и запуск в одноразовом Docker-контейнере (§11а).
 * Исходные тексты не меняются: rewrite применяется к копии во временной папке.
 */
public final class Runner {

    /**
     * @param baseDir папка для временных рабочих каталогов. Путь на хосте Docker и в процессе
     *                сервера должен совпадать (если сервер сам в контейнере с docker.sock —
     *                смонтировать эту папку по тому же пути). Env: BLUEPRINTS_RUN_DIR.
     * @param image   образ с JDK 21. Env: BLUEPRINTS_RUN_IMAGE.
     */
    public record Config(Path baseDir, String image, String memory, String cpus, Duration timeout) {
        public static Config defaults() {
            String dir = System.getenv("BLUEPRINTS_RUN_DIR");
            String image = System.getenv("BLUEPRINTS_RUN_IMAGE");
            return new Config(
                    Path.of(dir != null ? dir : System.getProperty("java.io.tmpdir") + "/blueprints-run"),
                    image != null ? image : "eclipse-temurin:21-jdk",
                    "256m", "1", Duration.ofSeconds(10));
        }
    }

    /** Результат запуска. Если compiled=false — заполнен только diagnostics. */
    public record RunResult(boolean compiled, List<String> diagnostics, String stdout, String stderr,
                            int exitCode, boolean timedOut, long millis, boolean truncated) {}

    /** Опции переписывания копии для запуска (§10.4). */
    public record Rewrite(boolean seedRandom, boolean packagePrivate) {
        public static final Rewrite RUN = new Rewrite(true, false);
        public static final Rewrite NONE = new Rewrite(false, false);
    }

    private static final int MAX_OUTPUT = 1 << 20;
    private static final Pattern MAIN_NAME = Pattern.compile("[\\w.$]+");
    private static final Pattern MAIN = Pattern.compile("public\\s+static\\s+void\\s+main\\s*\\(\\s*(final\\s+)?String");
    private static final Pattern PACKAGE = Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");
    private static final String SEED_CLASS = "bp.rt.Seed";
    private static final String SEED_SOURCE = "package bp.rt;\npublic final class Seed {\n"
            + "  private static final java.util.Random R = new java.util.Random(42);\n"
            + "  public static double random() { return R.nextDouble(); }\n}\n";

    private final Config config;

    public Runner(Config config) {
        this.config = config;
    }

    /** Переписывание одного файла (чистая функция, исходник не трогает). */
    // ponytail: regex, не AST — упоминания в строках/комментариях тоже заменятся; точнее — через source/JavaParser.
    public static String rewrite(String code, Rewrite opts) {
        if (opts.seedRandom()) {
            code = code.replaceAll("new\\s+(java\\.util\\.)?Random\\s*\\(\\s*\\)", "new $1Random(42)")
                       .replaceAll("\\bMath\\.random\\s*\\(\\s*\\)", SEED_CLASS + ".random()");
        }
        if (opts.packagePrivate()) {
            code = code.replaceAll("\\bprivate\\s+", "");
        }
        return code;
    }

    /** Полные имена классов с {@code main}, по порядку путей. */
    public static List<String> findMainClasses(Map<String, String> sources) {
        List<String> res = new ArrayList<>();
        sources.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> {
            if (!MAIN.matcher(e.getValue()).find()) return;
            String name = Path.of(e.getKey()).getFileName().toString().replaceAll("\\.java$", "");
            Matcher p = PACKAGE.matcher(e.getValue());
            res.add(p.find() ? p.group(1) + "." + name : name);
        });
        return res;
    }

    /** Компилирует все .java из srcDir в outDir одним вызовом. Пустой список — успех. */
    public static List<String> compile(Path srcDir, Path outDir) throws IOException {
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        if (jc == null) throw new IllegalStateException("Нужен JDK, а не JRE");
        List<Path> files;
        try (var s = Files.walk(srcDir)) {
            files = s.filter(p -> p.toString().endsWith(".java")).toList();
        }
        Files.createDirectories(outDir);
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = jc.getStandardFileManager(diags, null, StandardCharsets.UTF_8)) {
            boolean ok = jc.getTask(null, fm, diags, List.of("-d", outDir.toString(), "-proc:none"), null,
                    fm.getJavaFileObjectsFromPaths(files)).call();
            List<String> errors = new ArrayList<>();
            for (var d : diags.getDiagnostics()) {
                if (d.getKind() == Diagnostic.Kind.ERROR) {
                    String f = d.getSource() == null ? "" : Path.of(d.getSource().toUri()).getFileName() + ":" + d.getLineNumber() + ": ";
                    errors.add(f + d.getMessage(null));
                }
            }
            if (!ok && errors.isEmpty()) errors.add("compilation failed");
            return errors;
        }
    }

    /**
     * @param sources   относительный путь (например com/demo/Main.java) → текст
     * @param mainClass полное имя; null — взять единственный main, иначе IllegalArgumentException
     * @param stdin     текст для System.in
     */
    public RunResult run(Map<String, String> sources, String mainClass, String stdin, Rewrite rewrite) {
        if (mainClass != null && !MAIN_NAME.matcher(mainClass).matches()) {
            throw new IllegalArgumentException("Недопустимое имя main-класса: " + mainClass);
        }
        if (mainClass == null) {
            List<String> mains = findMainClasses(sources);
            if (mains.size() != 1) {
                throw new IllegalArgumentException("Нужно указать main-класс, найдено: " + mains);
            }
            mainClass = mains.get(0);
        }
        String id = UUID.randomUUID().toString().substring(0, 8);
        Path work = config.baseDir().toAbsolutePath().resolve("run-" + id);
        try {
            Path src = work.resolve("src");
            Path classes = work.resolve("classes");
            for (var e : sources.entrySet()) {
                Path p = src.resolve(e.getKey()).normalize();
                if (!p.startsWith(src)) throw new IllegalArgumentException("Путь вне проекта: " + e.getKey());
                Files.createDirectories(p.getParent());
                Files.writeString(p, rewrite(e.getValue(), rewrite), StandardCharsets.UTF_8);
            }
            if (rewrite.seedRandom() && sources.values().stream().anyMatch(c -> c.contains("Math.random"))) {
                Files.createDirectories(src.resolve("bp/rt"));
                Files.writeString(src.resolve("bp/rt/Seed.java"), SEED_SOURCE);
            }
            List<String> errors = compile(src, classes);
            if (!errors.isEmpty()) return new RunResult(false, errors, "", "", -1, false, 0, false);
            return runInDocker(classes, mainClass, stdin, id);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            deleteQuietly(work);
        }
    }

    private RunResult runInDocker(Path classes, String mainClass, String stdin, String id) throws IOException {
        String name = "bp-run-" + id;
        List<String> cmd = List.of("docker", "run", "--rm", "-i", "--name", name,
                "--network", "none", "--memory", config.memory(), "--cpus", config.cpus(),
                "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--read-only", "--tmpfs", "/tmp",
                "--mount", "type=bind,src=" + classes + ",dst=/app,readonly",
                config.image(), "java", "-Xmx" + heapFor(config.memory()), "-cp", "/app", mainClass);
        long t0 = System.nanoTime();
        Process p = new ProcessBuilder(cmd).start();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        boolean[] cut = new boolean[2];
        Thread tOut = daemon(() -> cut[0] = drain(p.getInputStream(), MAX_OUTPUT, out));
        Thread tErr = daemon(() -> cut[1] = drain(p.getErrorStream(), MAX_OUTPUT, err));
        Thread tIn = daemon(() -> {
            try (OutputStream in = p.getOutputStream()) {
                in.write(stdin.getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {
                // программа могла закрыть stdin раньше
            }
        });
        boolean timedOut = false;
        boolean interrupted = false;
        try {
            timedOut = !p.waitFor(config.timeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            interrupted = true;
        }
        if (timedOut || interrupted) {
            kill(name);
            p.destroyForcibly();
        }
        try {
            p.waitFor(5, TimeUnit.SECONDS);
            tOut.join(2000);
            tErr.join(2000);
            tIn.join(500);
        } catch (InterruptedException e) {
            interrupted = true;
        }
        if (interrupted) Thread.currentThread().interrupt();
        long ms = (System.nanoTime() - t0) / 1_000_000;
        int exit = p.isAlive() || timedOut || interrupted ? -1 : p.exitValue();
        return new RunResult(true, List.of(), out.toString(StandardCharsets.UTF_8), err.toString(StandardCharsets.UTF_8),
                exit, timedOut, ms, cut[0] || cut[1]);
    }

    private static Thread daemon(Runnable r) {
        Thread t = new Thread(r);
        t.setDaemon(true);
        t.start();
        return t;
    }

    /** Читает поток до конца, в sink кладёт не больше max байт, остаток отбрасывает. true — было усечение. */
    static boolean drain(InputStream in, int max, ByteArrayOutputStream sink) {
        boolean cut = false;
        byte[] buf = new byte[8192];
        try (in) {
            int n;
            while ((n = in.read(buf)) > 0) {
                int room = max - sink.size();
                if (n > room) cut = true;
                if (room > 0) sink.write(buf, 0, Math.min(n, room));
            }
        } catch (IOException ignored) {
            // поток закрыт убитым процессом
        }
        return cut;
    }

    /** 75% лимита контейнера, чтобы JVM не упиралась в OOM-killer. Формат лимита: 256m / 1g. */
    static String heapFor(String memory) {
        long mb = Long.parseLong(memory.replaceAll("[^0-9]", "")) * (memory.toLowerCase().endsWith("g") ? 1024 : 1);
        return Math.max(mb * 3 / 4, 16) + "m";
    }

    private static void kill(String name) {
        try {
            new ProcessBuilder("docker", "rm", "-f", name).redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor(15, TimeUnit.SECONDS);
        } catch (IOException | InterruptedException ignored) {
            // контейнер всё равно под --rm
        }
    }

    private static void deleteQuietly(Path dir) {
        try (var s = Files.walk(dir)) {
            s.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (IOException ignored) {
            // папка могла не создаться
        }
    }
}
