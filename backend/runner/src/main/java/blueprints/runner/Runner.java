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
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;
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
     * @param timeout таймаут запуска программы (main), 10 с
     * @param commandTimeout таймаут command-запуска пакета (JUnit launcher: старт платформы + все тесты), 30 с
     */
    public record Config(Path baseDir, String image, String memory, String cpus, Duration timeout, Duration commandTimeout) {
        public static final Duration DEFAULT_COMMAND_TIMEOUT = Duration.ofSeconds(30);

        /** commandTimeout — {@link #DEFAULT_COMMAND_TIMEOUT}. */
        public Config(Path baseDir, String image, String memory, String cpus, Duration timeout) {
            this(baseDir, image, memory, cpus, timeout, DEFAULT_COMMAND_TIMEOUT);
        }

        public static Config defaults() {
            String dir = System.getenv("BLUEPRINTS_RUN_DIR");
            String image = System.getenv("BLUEPRINTS_RUN_IMAGE");
            return new Config(
                    Path.of(dir != null ? dir : System.getProperty("java.io.tmpdir") + "/blueprints-run"),
                    image != null ? image : "eclipse-temurin:21-jdk",
                    "256m", "1", Duration.ofSeconds(10));
        }
    }

    /**
     * Результат запуска. Если compiled=false — заполнен только diagnostics.
     * aborted=true — запуск пакета не выполнялся (песочница не отвечала / прогон прерван), причина в stderr;
     * это не таймаут программы.
     */
    public record RunResult(boolean compiled, List<String> diagnostics, String stdout, String stderr,
                            int exitCode, boolean timedOut, long millis, boolean truncated, boolean aborted) {
        public RunResult(boolean compiled, List<String> diagnostics, String stdout, String stderr,
                         int exitCode, boolean timedOut, long millis, boolean truncated) {
            this(compiled, diagnostics, stdout, stderr, exitCode, timedOut, millis, truncated, false);
        }

        static RunResult aborted(String reason) {
            return new RunResult(true, List.of(), "", reason, -1, false, 0, false, true);
        }
    }

    /**
     * Программа пакетного запуска: исходники (путь → текст) и main-класс (null — единственный main).
     *
     * @param rewrite   переписывание копии именно этой программы; null — общее {@code rewrite} пакета
     * @param classpath дополнительный classpath компиляции (в процессе сервера), например jar JUnit
     */
    public record Program(Map<String, String> sources, String mainClass, Rewrite rewrite, List<Path> classpath) {
        public Program {
            classpath = classpath == null ? List.of() : List.copyOf(classpath);
        }

        public Program(Map<String, String> sources, String mainClass) {
            this(sources, mainClass, null, List.of());
        }
    }

    /**
     * Один запуск в пакете: индекс программы в списке {@link Program} и stdin.
     *
     * @param command null — {@code java -cp /app/p<i> <main>}; иначе argv, выполняемый в контейнере вместо него
     *                (классы программы — в {@link #programDir}, таймаут {@code Config.commandTimeout()};
     *                {@code JDK_JAVA_OPTIONS=-Xmx...}).
     *                Main-класс программы, у которой все запуски — command, не ищется.
     */
    public record Job(int program, String stdin, List<String> command) {
        public Job {
            command = command == null ? null : List.copyOf(command);
        }

        public Job(int program, String stdin) {
            this(program, stdin, null);
        }
    }

    /** Опции переписывания копии для запуска (§10.4). */
    public record Rewrite(boolean seedRandom, boolean packagePrivate) {
        public static final Rewrite RUN = new Rewrite(true, false);
        public static final Rewrite NONE = new Rewrite(false, false);
        /** Сборка с JUnit-тестами (§10.2): seed + {@code private} → package-private. */
        public static final Rewrite JUNIT = new Rewrite(true, true);
    }

    /** Папка классов программы {@code i} в контейнере пакетного запуска. */
    public static String programDir(int i) {
        return "/app/p" + i;
    }

    /** Скрипты запусков пакета в контейнере (read-only), см. {@link #jobScript}. */
    static final String JOBS = "/app/jobs";
    private static final int MAX_OUTPUT = 1 << 20;
    static final String SANDBOX_DEAD = "прогон прерван: песочница не отвечала";
    private static final Pattern MAIN_NAME = Pattern.compile("[\\w.$]+");
    private static final Pattern MOUNT_DST = Pattern.compile("(/[\\w.-]+)+");
    private static final Pattern MAIN = Pattern.compile("public\\s+static\\s+void\\s+main\\s*\\(\\s*(final\\s+)?String");
    private static final Pattern PACKAGE = Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");
    private static final String SEED_CLASS = "bp.rt.Seed";
    private static final String SEED_SOURCE = "package bp.rt;\npublic final class Seed {\n"
            + "  private static final java.util.Random R = new java.util.Random(42);\n"
            + "  public static double random() { return R.nextDouble(); }\n}\n";

    private final Config config;
    private final String docker;
    private final long startTimeoutMs;
    private final long execSlackMs;

    public Runner(Config config) {
        this(config, "docker", 120_000, 5_000);
    }

    /** Для тестов: другой исполняемый docker и укороченные служебные таймауты. */
    Runner(Config config, String docker, long startTimeoutMs, long execSlackMs) {
        this.config = config;
        this.docker = docker;
        this.startTimeoutMs = startTimeoutMs;
        this.execSlackMs = execSlackMs;
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
        return compile(srcDir, outDir, List.of());
    }

    /** То же с дополнительным classpath (пустой — без {@code -cp}, как {@link #compile(Path, Path)}). */
    public static List<String> compile(Path srcDir, Path outDir, List<Path> classpath) throws IOException {
        return compile(srcDir, outDir, classpath, List.of());
    }

    private static List<String> compile(Path srcDir, Path outDir, List<Path> classpath, List<String> extra) throws IOException {
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        if (jc == null) throw new IllegalStateException("Нужен JDK, а не JRE");
        List<Path> files;
        try (var s = Files.walk(srcDir)) {
            files = s.filter(p -> p.toString().endsWith(".java")).toList();
        }
        Files.createDirectories(outDir);
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = jc.getStandardFileManager(diags, null, StandardCharsets.UTF_8)) {
            List<String> opts = new ArrayList<>(List.of("-d", outDir.toString(), "-proc:none"));
            opts.addAll(extra);
            if (!classpath.isEmpty()) {
                opts.addAll(List.of("-cp", String.join(java.io.File.pathSeparator,
                        classpath.stream().map(Path::toString).toList())));
            }
            boolean ok = jc.getTask(null, fm, diags, opts, null,
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

    /** Исполняемый jar: {@code jar} — байты (null при ошибке компиляции), {@code diagnostics} — ошибки javac. */
    public record JarResult(byte[] jar, List<String> diagnostics) {}

    /**
     * Исполняемый jar из чистого кода (§11): без переписывания, {@code --release 21}, в манифесте Main-Class,
     * внутри только классы. Ничего не запускает, Docker не нужен.
     *
     * @param sources   путь → текст, только исходники (без tests/ и .blueprints/ — отбирает вызывающий)
     * @param mainClass полное имя; null — единственный main, иначе IllegalArgumentException
     */
    public static JarResult jar(Map<String, String> sources, String mainClass) {
        mainClass = resolveMain(sources, mainClass);
        Path work = null;
        try {
            work = Files.createTempDirectory("bp-jar-");
            Path src = work.resolve("src"), classes = work.resolve("classes");
            writeSources(sources, Rewrite.NONE, src);
            List<String> errors = compile(src, classes, List.of(), List.of("--release", "21"));
            if (!errors.isEmpty()) return new JarResult(null, errors);
            Manifest mf = new Manifest();
            mf.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
            mf.getMainAttributes().put(Attributes.Name.MAIN_CLASS, mainClass);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (JarOutputStream out = new JarOutputStream(bytes, mf); var s = Files.walk(classes)) {
                for (Path p : s.filter(Files::isRegularFile).sorted().toList()) {
                    out.putNextEntry(new JarEntry(classes.relativize(p).toString().replace('\\', '/')));
                    Files.copy(p, out);
                    out.closeEntry();
                }
            }
            return new JarResult(bytes.toByteArray(), List.of());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            if (work != null) deleteQuietly(work);
        }
    }

    /**
     * @param sources   относительный путь (например com/demo/Main.java) → текст
     * @param mainClass полное имя; null — взять единственный main, иначе IllegalArgumentException
     * @param stdin     текст для System.in
     */
    public RunResult run(Map<String, String> sources, String mainClass, String stdin, Rewrite rewrite) {
        mainClass = resolveMain(sources, mainClass);
        String id = UUID.randomUUID().toString().substring(0, 8);
        Path work = config.baseDir().toAbsolutePath().resolve("run-" + id);
        try {
            Path classes = work.resolve("classes");
            List<String> errors = prepare(sources, rewrite, List.of(), work.resolve("src"), classes);
            if (!errors.isEmpty()) return new RunResult(false, errors, "", "", -1, false, 0, false);
            return runInDocker(classes, mainClass, stdin, id);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            deleteQuietly(work);
        }
    }

    /**
     * Пакетный запуск одной программы: {@link #runBatch} с единственной программой.
     *
     * @return по результату на каждый stdin, в том же порядке; при ошибке компиляции — у всех compiled=false
     */
    public List<RunResult> runAll(Map<String, String> sources, String mainClass, List<String> stdins, Rewrite rewrite) {
        return runBatch(List.of(new Program(sources, mainClass)), stdins.stream().map(s -> new Job(0, s)).toList(), rewrite);
    }

    /**
     * Пакетный запуск нескольких программ (например, текущей версии и оригинала) в <b>одном</b> одноразовом контейнере.
     * Каждая программа компилируется отдельно (с переписыванием в копии) и монтируется в {@code /app/p<i>};
     * запуски выполняются последовательно ({@code docker exec}) в порядке {@code jobs}, таймаут {@code config.timeout()}
     * — на каждый запуск, плюс общий таймаут контейнера. Ограничения — как у {@link #run}. Между запусками чистится /tmp.
     * Запуски программы с ошибкой компиляции не выполняются (compiled=false). Если песочница перестала отвечать,
     * контейнер убивается, оставшиеся запуски получают aborted=true.
     *
     * @return по результату на каждый job, в том же порядке
     */
    public List<RunResult> runBatch(List<Program> programs, List<Job> jobs, Rewrite rewrite) {
        return runBatch(programs, jobs, rewrite, Map.of());
    }

    /**
     * {@link #runBatch(List, List, Rewrite)} с дополнительными файлами, смонтированными в контейнер read-only
     * (например, jar JUnit launcher'а для command-запусков).
     *
     * @param files абсолютный путь в контейнере (не под {@code /app}) → файл в процессе сервера; копируется в
     *              рабочую папку запуска, поэтому виден Docker'у так же, как классы программ
     */
    public List<RunResult> runBatch(List<Program> programs, List<Job> jobs, Rewrite rewrite, Map<String, Path> files) {
        for (var f : files.entrySet()) {
            String dst = f.getKey();
            if (!MOUNT_DST.matcher(dst).matches() || dst.equals("/app") || dst.startsWith("/app/") || dst.contains("/..")) {
                throw new IllegalArgumentException("Недопустимая точка монтирования: " + dst);
            }
            if (!Files.isRegularFile(f.getValue())) throw new IllegalArgumentException("Нет файла: " + f.getValue());
        }
        List<String> mains = new ArrayList<>();
        for (int i = 0; i < programs.size(); i++) {
            Program p = programs.get(i);
            int idx = i;
            // main не нужен, только если программу запускают исключительно command-запуски
            boolean onlyCommands = jobs.stream().anyMatch(j -> j.program() == idx)
                    && jobs.stream().filter(j -> j.program() == idx).allMatch(j -> j.command() != null);
            mains.add(onlyCommands ? null : resolveMain(p.sources(), p.mainClass()));
        }
        for (Job j : jobs) {
            if (j.program() < 0 || j.program() >= programs.size()) {
                throw new IllegalArgumentException("Нет программы с индексом " + j.program());
            }
        }
        if (jobs.isEmpty()) return List.of();
        String id = UUID.randomUUID().toString().substring(0, 8);
        Path work = config.baseDir().toAbsolutePath().resolve("run-" + id);
        try {
            List<Path> classes = new ArrayList<>();
            List<List<String>> errors = new ArrayList<>();
            for (int i = 0; i < programs.size(); i++) {
                Path c = work.resolve("p" + i).resolve("classes");
                classes.add(c);
                Program p = programs.get(i);
                errors.add(prepare(p.sources(), p.rewrite() != null ? p.rewrite() : rewrite, p.classpath(),
                        work.resolve("p" + i).resolve("src"), c));
            }
            if (jobs.stream().noneMatch(j -> errors.get(j.program()).isEmpty())) {
                return jobs.stream().map(j -> compileFailed(errors.get(j.program()))).toList();
            }
            Map<Path, String> extra = new java.util.LinkedHashMap<>();
            int k = 0;
            for (var f : files.entrySet()) {
                Path copy = work.resolve("files").resolve("f" + k++).resolve(f.getValue().getFileName().toString());
                Files.createDirectories(copy.getParent());
                Files.copy(f.getValue(), copy);
                extra.put(copy, f.getKey());
            }
            return runBatchInDocker(classes, mains, errors, jobs, id, extra, work.resolve("jobs"));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } finally {
            deleteQuietly(work);
        }
    }

    private static RunResult compileFailed(List<String> errors) {
        return new RunResult(false, errors, "", "", -1, false, 0, false);
    }

    private static String resolveMain(Map<String, String> sources, String mainClass) {
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
        return mainClass;
    }

    /** Пишет переписанную копию исходников в src и компилирует в classes. Пустой список — успех. */
    private static List<String> prepare(Map<String, String> sources, Rewrite rewrite, List<Path> classpath,
                                        Path src, Path classes) throws IOException {
        writeSources(sources, rewrite, src);
        return compile(src, classes, classpath);
    }

    /** Пишет переписанную копию исходников в src (вместе с bp.rt.Seed, если он нужен). */
    private static void writeSources(Map<String, String> sources, Rewrite rewrite, Path src) throws IOException {
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
    }

    /** Общие флаги изоляции контейнера (§11а), без образа и команды. mounts: папка классов → точка монтирования. */
    private List<String> sandboxArgs(String name, Map<Path, String> mounts) {
        List<String> args = new ArrayList<>(List.of("--name", name,
                "--network", "none", "--memory", config.memory(), "--cpus", config.cpus(),
                "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--read-only", "--tmpfs", "/tmp"));
        mounts.forEach((src, dst) -> args.addAll(List.of("--mount", "type=bind,src=" + src + ",dst=" + dst + ",readonly")));
        return args;
    }

    /**
     * Скрипт запуска пакета: чистка /tmp и argv под {@code timeout}. Кладётся файлом в {@link #JOBS} и выполняется
     * {@code sh <файл>}, а не {@code sh -c "..."}: на Windows ProcessBuilder склеивает argv в одну строку, и docker.exe
     * разбирает её по своим правилам — аргументы с кавычками и пробелами ломались. Каждый аргумент — в одинарных
     * кавычках ({@code '} → {@code '\''}): подстановок shell нет.
     */
    static String jobScript(double timeoutSecs, List<String> argv) {
        StringBuilder s = new StringBuilder("find /tmp -mindepth 1 -delete 2>/dev/null; exec timeout -k 1 ")
                .append(String.format(Locale.ROOT, "%.3f", timeoutSecs));
        for (String a : argv) s.append(" '").append(a.replace("'", "'\\''")).append('\'');
        return s.append('\n').toString();
    }

    private List<RunResult> runBatchInDocker(List<Path> classes, List<String> mains, List<List<String>> errors,
                                             List<Job> jobs, String id, Map<Path, String> extraMounts, Path jobsDir)
            throws IOException {
        String name = "bp-batch-" + id;
        long mainMs = config.timeout().toMillis();
        long commandMs = config.commandTimeout().toMillis();
        // общий таймаут контейнера: каждый запуск (со своим таймаутом) + запас на старт JVM/exec; по нему контейнер
        // завершится и сам (sleep)
        long totalMs = jobs.stream().filter(j -> errors.get(j.program()).isEmpty())
                .mapToLong(j -> (j.command() == null ? mainMs : commandMs) + execSlackMs).sum() + startTimeoutMs;
        Files.createDirectories(jobsDir);
        for (int k = 0; k < jobs.size(); k++) {
            Job job = jobs.get(k);
            int i = job.program();
            if (!errors.get(i).isEmpty()) continue;
            List<String> argv = job.command() != null ? job.command()
                    : List.of("java", "-Xmx" + heapFor(config.memory()), "-cp", programDir(i), mains.get(i));
            Files.writeString(jobsDir.resolve(k + ".sh"),
                    jobScript((job.command() == null ? mainMs : commandMs) / 1000.0, argv), StandardCharsets.UTF_8);
        }
        Map<Path, String> mounts = new java.util.LinkedHashMap<>();
        for (int i = 0; i < classes.size(); i++) mounts.put(classes.get(i), programDir(i));
        mounts.put(jobsDir, JOBS);
        mounts.putAll(extraMounts);
        List<String> start = new ArrayList<>(List.of(docker, "run", "-d", "--rm"));
        start.addAll(sandboxArgs(name, mounts));
        start.addAll(List.of(config.image(), "sleep", Long.toString(totalMs / 1000 + 1)));
        List<RunResult> results = new ArrayList<>();
        try {
            Process starter = new ProcessBuilder(start).redirectErrorStream(true).start();
            ByteArrayOutputStream startOut = new ByteArrayOutputStream();
            Thread tStart = daemon(() -> drain(starter.getInputStream(), MAX_OUTPUT, startOut));
            boolean started = starter.waitFor(startTimeoutMs, TimeUnit.MILLISECONDS);
            if (!started) {
                starter.destroyForcibly();
                // демон мог создать контейнер уже после нашего rm -f — повторяем rm -f в фоне;
                // в крайнем случае контейнер завершится сам по sleep (общий таймаут) и удалится по --rm
                reapLater(name);
                throw new IllegalStateException("Контейнер не запустился за " + startTimeoutMs / 1000 + " с");
            }
            tStart.join(2000);
            if (starter.exitValue() != 0) {
                throw new IllegalStateException("Не удалось запустить контейнер: " + startOut.toString(StandardCharsets.UTF_8).strip());
            }
            long deadline = System.nanoTime() + totalMs * 1_000_000;
            String abortReason = null;
            for (int k = 0; k < jobs.size(); k++) {
                Job job = jobs.get(k);
                int i = job.program();
                if (!errors.get(i).isEmpty()) {
                    results.add(compileFailed(errors.get(i)));
                    continue;
                }
                if (abortReason == null && System.nanoTime() > deadline) abortReason = "прогон прерван: превышен общий таймаут контейнера";
                if (abortReason == null && Thread.currentThread().isInterrupted()) abortReason = "прогон прерван";
                if (abortReason != null) {
                    results.add(RunResult.aborted(abortReason));
                    continue;
                }
                long perRunMs = job.command() == null ? mainMs : commandMs;
                // скрипт запуска записан файлом до старта контейнера: в argv docker нет пробелов и кавычек
                List<String> cmd = new ArrayList<>(List.of(docker, "exec", "-i"));
                if (job.command() != null) cmd.addAll(List.of("-e", "JDK_JAVA_OPTIONS=-Xmx" + heapFor(config.memory())));
                cmd.addAll(List.of(name, "sh", JOBS + "/" + k + ".sh"));
                RunResult r = execute(cmd, job.stdin(), perRunMs + execSlackMs, name);
                if (r.timedOut()) {
                    // docker exec не вернулся даже после таймаута программы: песочница не отвечает,
                    // контейнер уже убит (docker rm -f) — этот и остальные запуски не выполнены
                    abortReason = SANDBOX_DEAD;
                    results.add(RunResult.aborted(abortReason));
                    continue;
                }
                boolean killedByTimeout = (r.exitCode() == 124 || r.exitCode() == 137) && r.millis() >= perRunMs;
                results.add(killedByTimeout
                        ? new RunResult(true, List.of(), r.stdout(), r.stderr(), -1, true, r.millis(), r.truncated())
                        : r);
            }
            return results;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Пакетный запуск прерван", e);
        } finally {
            kill(name);
        }
    }

    /** Несколько повторных docker rm -f в фоне: на случай, если контейнер появится после первого удаления. */
    private void reapLater(String name) {
        daemon(() -> {
            for (int k = 0; k < 6; k++) {
                try {
                    Thread.sleep(Math.max(1000, execSlackMs));
                } catch (InterruptedException e) {
                    return;
                }
                kill(name);
            }
        });
    }

    private RunResult runInDocker(Path classes, String mainClass, String stdin, String id) throws IOException {
        String name = "bp-run-" + id;
        List<String> cmd = new ArrayList<>(List.of(docker, "run", "--rm", "-i"));
        cmd.addAll(sandboxArgs(name, Map.of(classes, "/app")));
        cmd.addAll(List.of(config.image(), "java", "-Xmx" + heapFor(config.memory()), "-cp", "/app", mainClass));
        return execute(cmd, stdin, config.timeout().toMillis(), name);
    }

    /** Запускает процесс docker, пишет stdin, ждёт timeoutMs; по таймауту — docker rm -f killName. */
    private RunResult execute(List<String> cmd, String stdin, long timeoutMs, String killName) throws IOException {

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
            timedOut = !p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            interrupted = true;
        }
        if (timedOut || interrupted) {
            kill(killName);
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

    private void kill(String name) {
        try {
            new ProcessBuilder(docker, "rm", "-f", name).redirectErrorStream(true)
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
