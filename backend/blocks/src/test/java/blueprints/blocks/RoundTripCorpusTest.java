package blueprints.blocks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import blueprints.model.Block;
import blueprints.source.LoadedProject;
import blueprints.source.ProjectLoader;
import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import java.io.File;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Регрессионная страховка §5: каждый файл samples/roundtrip и samples/demo -> блоки -> Java (тело КАЖДОГО метода
 * сгенерировано заново) -> компилируется и даёт тот же stdout и код выхода. Дополнительно:
 * повторный разбор даёт то же дерево; неизменённое дерево -> файл байт в байт; CRLF-файл остаётся CRLF.
 */
class RoundTripCorpusTest {
    static final Path ROUNDTRIP = Path.of("../../samples/roundtrip");
    static final Path DEMO = Path.of("../../samples/demo");
    static final JavaParser PARSER = new JavaParser(new ParserConfiguration()
            .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21));

    @TempDir
    Path tmp;

    record Regen(String text, int methods) {}

    /** Методы и конструкторы членов именованных типов (локальные/анонимные — внутри текста других методов). */
    static List<CallableDeclaration<?>> members(CompilationUnit cu) {
        List<CallableDeclaration<?>> out = new ArrayList<>();
        for (CallableDeclaration<?> d : cu.findAll(CallableDeclaration.class)) {
            if (d.getParentNode().orElse(null) instanceof TypeDeclaration<?> t && (t.isTopLevelType() || t.isNestedType())) {
                out.add(d);
            }
        }
        return out;
    }

    /** id как в дереве проекта: FQN.имя~N / FQN.<init>~N. */
    static String id(CompilationUnit cu, CallableDeclaration<?> d) {
        TypeDeclaration<?> t = (TypeDeclaration<?>) d.getParentNode().orElseThrow();
        String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString() + ".").orElse("");
        List<? extends CallableDeclaration<?>> same = d.isConstructorDeclaration() ? t.getConstructors()
                : t.getMethodsByName(d.getNameAsString());
        String name = d.isConstructorDeclaration() ? "<init>" : d.getNameAsString();
        return pkg + MethodLocator.binary(t) + "." + name + "~" + same.indexOf(d);
    }

    /** null — JavaParser файл не разбирает (файл остаётся текстом). */
    static CompilationUnit parse(String text) {
        ParseResult<CompilationUnit> r = PARSER.parse(text);
        return r.isSuccessful() ? r.getResult().orElseThrow() : null;
    }

    /** Все тела сгенерированы из блоков; с конца файла, чтобы смещения ранних методов не сдвигались. */
    static Regen regenerate(String file, String text) {
        CompilationUnit cu = parse(text);
        if (cu == null) return new Regen(text, 0);
        List<CallableDeclaration<?>> ms = new ArrayList<>(members(cu));
        ms.sort(Comparator.comparing((CallableDeclaration<?> d) -> d.getBegin().orElseThrow()).reversed());
        String out = text;
        for (CallableDeclaration<?> d : ms) {
            Block tree = AstToBlocks.convert(d, id(cu, d), file);
            // неизменённое дерево — файл байт в байт
            assertEquals(text, BlocksToJava.replaceMethod(text, id(cu, d), tree), () -> file + " " + id(cu, d));
            out = BlocksToJava.splice(out, d, tree, tree);
        }
        CompilationUnit again = parse(out);
        String gen = out;
        assertTrue(again != null, () -> file + ": сгенерированный код не разбирается\n" + gen);
        List<CallableDeclaration<?>> before = members(cu), after = members(again);
        assertEquals(before.size(), after.size(), file);
        for (int i = 0; i < before.size(); i++) {
            Block a = AstToBlocks.convert(before.get(i), "x", file), b = AstToBlocks.convert(after.get(i), "x", file);
            int k = i;
            assertTrue(BlocksToJava.sameTree(a, b), () -> file + ": дерево изменилось после round-trip: "
                    + id(cu, before.get(k)) + "\n" + a + "\n" + b);
        }
        return new Regen(out, ms.size());
    }

    static String crlf(String s) {
        return s.replace("\r\n", "\n").replace("\n", "\r\n");
    }

    @Test
    void roundtripCorpus() throws Exception {
        roundtrip(false);
    }

    @Test
    void roundtripCorpusCrlf() throws Exception {
        roundtrip(true);
    }

    void roundtrip(boolean crlf) throws Exception {
        List<Path> files;
        try (Stream<Path> s = Files.list(ROUNDTRIP)) {
            files = s.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
        assertTrue(files.size() >= 20, "корпус samples/roundtrip не найден");
        int methods = 0, changed = 0;
        List<String> asText = new ArrayList<>();
        for (Path p : files) {
            String name = p.getFileName().toString();
            String text = Files.readString(p);
            if (crlf) text = crlf(text);
            Regen r = regenerate(name, text);
            methods += r.methods();
            if (r.methods() == 0) asText.add(name);
            else if (!text.equals(r.text())) changed++; // форматирование может совпасть с генератором байт в байт
            if (crlf) assertFalse(r.text().replace("\r\n", "").contains("\n") || r.text().contains("\r\r"), name + ": LF в CRLF-файле");
            String cls = name.substring(0, name.length() - 5);
            Path dir = tmp.resolve((crlf ? "crlf-" : "lf-") + cls);
            Path src = dir.resolve("src").resolve(name);
            Files.createDirectories(src.getParent());
            Files.writeString(src, r.text());
            compile(dir.resolve("classes"), List.of(src), r.text());
            Path in = ROUNDTRIP.resolve(cls + ".in");
            Path exitFile = ROUNDTRIP.resolve("expected").resolve(cls + ".exit");
            int wantExit = Files.exists(exitFile) ? Integer.parseInt(Files.readString(exitFile).strip()) : 0;
            Run run = run(dir.resolve("classes"), cls, Files.exists(in) ? in : null);
            assertEquals(Files.readString(ROUNDTRIP.resolve("expected").resolve(cls + ".out")), run.stdout(), name + ": stdout");
            assertEquals(wantExit, run.exit(), name + ": код выхода");
        }
        assertTrue(methods > 50, "сгенерировано методов: " + methods);
        assertTrue(changed > 5, "тела действительно сгенерированы заново, изменённых файлов: " + changed);
        // JavaParser 3.26.2 (и 3.28.2) не разбирает локальные enum/interface: файл остаётся текстом
        assertEquals(List.of("NestedClasses.java"), asText);
    }

    /** Загрузка не падает на файле, который JavaParser не разбирает: он грузится как текст. */
    @Test
    void unparsableByJavaParserLoadsAsText() throws Exception {
        byte[] bytes = Files.readAllBytes(ROUNDTRIP.resolve("NestedClasses.java"));
        LoadedProject p = ProjectLoader.load(List.of(new ProjectLoader.Upload("NestedClasses.java", bytes)));
        assertEquals(1, p.files().size());
        assertTrue(java.util.Arrays.equals(bytes, p.files().get(0).content()));
        assertTrue(p.mainClasses().contains("NestedClasses"));
    }

    @Test
    void demo() throws Exception {
        Path srcRoot = DEMO.resolve("src");
        List<Path> files;
        try (Stream<Path> s = Files.walk(srcRoot)) {
            files = s.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
        assertFalse(files.isEmpty(), "samples/demo не найден");
        Path out = tmp.resolve("demo-src");
        List<Path> written = new ArrayList<>();
        int methods = 0;
        for (Path p : files) {
            String rel = srcRoot.relativize(p).toString().replace(File.separatorChar, '/');
            Regen r = regenerate(rel, Files.readString(p));
            methods += r.methods();
            Path dst = out.resolve(rel);
            Files.createDirectories(dst.getParent());
            Files.writeString(dst, r.text());
            written.add(dst);
        }
        assertTrue(methods > 30, "методов: " + methods);
        Path classes = tmp.resolve("demo-classes");
        compile(classes, written, "");
        Map<Path, Path> cases = new LinkedHashMap<>();
        try (Stream<Path> s = Files.list(DEMO.resolve("tests"))) {
            s.filter(p -> p.toString().endsWith(".in")).sorted()
                    .forEach(in -> cases.put(in, in.resolveSibling(in.getFileName().toString().replace(".in", ".out"))));
        }
        assertFalse(cases.isEmpty());
        for (var e : cases.entrySet()) {
            Run run = run(classes, "com.demo.Main", e.getKey());
            assertEquals(Files.readString(e.getValue()), run.stdout(), e.getKey().toString());
        }
    }

    // ---- компиляция и запуск ----

    record Run(String stdout, int exit) {}

    static void compile(Path classes, List<Path> sources, String shown) throws IOException {
        Files.createDirectories(classes);
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        StringWriter err = new StringWriter();
        List<String> args = new ArrayList<>(List.of("--release", "21", "-encoding", "UTF-8", "-nowarn", "-d", classes.toString()));
        var fm = jc.getStandardFileManager(null, null, StandardCharsets.UTF_8);
        boolean ok = jc.getTask(err, fm, null, args, null, fm.getJavaFileObjectsFromPaths(sources)).call();
        fm.close();
        if (!ok) fail("не компилируется: " + err + "\n" + shown);
    }

    static Run run(Path classes, String main, Path stdin) throws Exception {
        String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        ProcessBuilder pb = new ProcessBuilder(java, "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8",
                "-Duser.language=en", "-Duser.country=US", "-cp", classes.toString(), main);
        pb.redirectInput(stdin != null ? ProcessBuilder.Redirect.from(stdin.toFile()) : ProcessBuilder.Redirect.from(nullFile()));
        pb.redirectError(ProcessBuilder.Redirect.DISCARD);
        Path outFile = Files.createTempFile(classes.getParent(), "stdout", ".txt");
        pb.redirectOutput(outFile.toFile());
        Process p = pb.start();
        if (!p.waitFor(10, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            fail(main + ": таймаут");
        }
        String stdout = Files.readString(outFile);
        // ожидания в LF; println на Windows пишет CRLF
        if (File.separatorChar == '\\') stdout = stdout.replace("\r\n", "\n");
        return new Run(stdout, p.exitValue());
    }

    static File nullFile() {
        return new File(System.getProperty("os.name").startsWith("Windows") ? "NUL" : "/dev/null");
    }
}
