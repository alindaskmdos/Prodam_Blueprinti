package blueprints.source;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;

class ProjectLoaderTest {
    static byte[] zip(Map<String, byte[]> files) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(b)) {
            for (var e : files.entrySet()) {
                z.putNextEntry(new ZipEntry(e.getKey()));
                z.write(e.getValue());
                z.closeEntry();
            }
        }
        return b.toByteArray();
    }

    static byte[] b(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    static List<ProjectLoader.Upload> demo(String prefix) throws IOException {
        Path root = Path.of("../../samples/demo");
        List<ProjectLoader.Upload> ups = new ArrayList<>();
        try (Stream<Path> s = Files.walk(root)) {
            for (Path p : s.filter(Files::isRegularFile).sorted().toList()) {
                ups.add(new ProjectLoader.Upload(prefix + root.relativize(p).toString().replace('\\', '/'), Files.readAllBytes(p)));
            }
        }
        return ups;
    }

    static LoadException fails(List<ProjectLoader.Upload> ups) {
        return assertThrows(LoadException.class, () -> ProjectLoader.load(ups));
    }

    @Test
    void zipSlipDotDot() throws IOException {
        var e = fails(List.of(new ProjectLoader.Upload("a.zip", zip(Map.of("../evil/A.java", b("class A {}"))))));
        assertEquals("ZIP_SLIP", e.code());
    }

    @Test
    void zipSlipAbsolute() throws IOException {
        assertEquals("ZIP_SLIP", fails(List.of(new ProjectLoader.Upload("a.zip", zip(Map.of("/etc/A.java", b("class A {}")))))).code());
        assertEquals("ZIP_SLIP", fails(List.of(new ProjectLoader.Upload("../A.java", b("class A {}")))).code());
    }

    @Test
    void zipBombBySize() throws IOException {
        // сжимается в ~20 КБ, распаковывается в 21 МБ
        byte[] big = new byte[21 * 1024 * 1024];
        java.util.Arrays.fill(big, (byte) ' ');
        byte[] z = zip(Map.of("A.java", big));
        assertTrue(z.length < 1024 * 1024);
        assertEquals("LIMIT_EXCEEDED", fails(List.of(new ProjectLoader.Upload("bomb.zip", z))).code());
    }

    @Test
    void zipBombByFileCount() throws IOException {
        Map<String, byte[]> m = new LinkedHashMap<>();
        for (int i = 0; i < 2001; i++) m.put("p/C" + i + ".java", b("class C" + i + " {}"));
        assertEquals("LIMIT_EXCEEDED", fails(List.of(new ProjectLoader.Upload("many.zip", zip(m)))).code());
    }

    @Test
    void wrapperStripped() throws IOException {
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload("x.zip", zip(Map.of(
                "proj/src/a/A.java", b("package a; public class A {}"),
                "proj/tests/t.in", b("1\n"))))));
        assertEquals("src/a/A.java", p.files().get(0).path());
        assertEquals("proj/", p.root());
        assertTrue(p.testFiles().containsKey("tests/t.in"));
        assertTrue(p.warnings().isEmpty());
        // экспорт возвращает обёртку обратно
        assertEquals(List.of("proj/src/a/A.java", "proj/tests/t.in"), names(ProjectExporter.zip(p, true)));
    }

    @Test
    void wrapperEqualToPackageSegmentGivesNoMismatch() throws IOException {
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload("x.zip", zip(new LinkedHashMap<>(Map.of(
                "com/demo/A.java", b("package com.demo; class A {}"),
                "com/demo/B.java", b("package com.demo; class B {}")))))));
        assertEquals("com/", p.root());
        assertEquals(List.of(), p.warnings());
    }

    @Test
    void nonUtf8EntryNamesRejectedAsInvalidRequest() throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bos, java.nio.charset.Charset.forName("CP866"))) {
            z.putNextEntry(new ZipEntry("Привет.java"));
            z.write(b("class A {}"));
            z.closeEntry();
        }
        assertEquals("INVALID_REQUEST", fails(List.of(new ProjectLoader.Upload("ru.zip", bos.toByteArray()))).code());
    }

    static List<String> names(byte[] z) throws IOException {
        List<String> out = new ArrayList<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(z))) {
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) out.add(e.getName());
        }
        return out;
    }

    @Test
    void noWrapperWhenRootFilePresent() {
        var p = ProjectLoader.load(List.of(
                new ProjectLoader.Upload("A.java", b("class A {}")),
                new ProjectLoader.Upload("sub/B.java", b("package sub; class B {}"))));
        assertEquals("A.java", p.files().get(0).path());
        assertEquals("", p.files().get(0).pkg());
    }

    @Test
    void duplicateFqnListsFiles() {
        var e = fails(List.of(
                new ProjectLoader.Upload("one/a/A.java", b("package a; class A {}")),
                new ProjectLoader.Upload("two/a/A.java", b("package a; class A {}"))));
        assertEquals("DUPLICATE_FQN", e.code());
        assertTrue(e.getMessage().contains("one/a/A.java") && e.getMessage().contains("two/a/A.java"));
        assertEquals(List.of("one/a/A.java", "two/a/A.java"), e.files());
    }

    @Test
    void packageMismatchWarns() {
        var p = ProjectLoader.load(List.of(
                new ProjectLoader.Upload("C.java", b("class C {}")), // чтобы src/ не посчитался обёрткой
                new ProjectLoader.Upload("src/a/A.java", b("package a; class A {}")),
                new ProjectLoader.Upload("src/a/B.java", b("package other; class B {}"))));
        assertEquals(1, p.warnings().size());
        assertEquals("PACKAGE_MISMATCH", p.warnings().get(0).code());
        assertEquals("src/a/B.java", p.warnings().get(0).file());
        assertEquals(3, p.files().size());
    }

    @Test
    void jarWithoutSources() throws IOException {
        var e = fails(List.of(new ProjectLoader.Upload("lib.jar", zip(Map.of("a/A.class", new byte[] {1, 2})))));
        assertEquals("NO_SOURCES", e.code());
        assertTrue(e.getMessage().contains("нужны исходники, а не скомпилированный код"));
    }

    @Test
    void jarWithSourcesIgnoresClasses() throws IOException {
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload("lib-sources.jar", zip(Map.of(
                "a/A.java", b("package a; class A {}"), "a/A.class", new byte[] {1})))));
        assertEquals(1, p.files().size());
    }

    @Test
    void syntaxErrorRejected() {
        assertEquals("PARSE_ERROR", fails(List.of(new ProjectLoader.Upload("A.java", b("class A {")))).code());
    }

    @Test
    void javaParserGapLoadsAsText() {
        // локальный enum — корректная Java 16+, но JavaParser 3.26 его не разбирает
        byte[] src = b("package a;\npublic class A {\n public static void main(String[] x) {\n  enum L { X }\n  System.out.println(L.X);\n }\n}\n");
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload("a/A.java", src)));
        assertArrayEquals(src, p.files().get(0).content());
        assertEquals("a", p.files().get(0).pkg());
        assertEquals(List.of("a.A"), p.mainClasses());
        assertEquals("UNPARSED_FILE", p.warnings().get(0).code());
        assertEquals(List.of(), TreeBuilder.build(p).get(0).files().get(0).classes());
        // настоящая ошибка синтаксиса по-прежнему отказ
        assertEquals("PARSE_ERROR", fails(List.of(new ProjectLoader.Upload("A.java", b("class A { void m() { enum } }")))).code());
    }

    @Test
    void demoLoadsWithoutWarningsAndRoundTrips() throws IOException {
        var ups = demo("demo/");
        var p = ProjectLoader.load(ups);
        assertEquals(17, p.files().size());
        assertTrue(p.warnings().isEmpty());
        assertEquals(List.of("com.demo.Main"), p.mainClasses());
        assertTrue(p.testFiles().containsKey("tests/basic.in"));
        assertEquals(12, p.testFiles().size());

        var tree = TreeBuilder.build(p);
        assertEquals(List.of("com.demo", "com.demo.model", "com.demo.service", "com.demo.util"),
                tree.stream().map(TreeBuilder.PackageNode::name).toList());
        var all = tree.stream().flatMap(n -> n.files().stream()).flatMap(f -> f.classes().stream()).toList();
        assertTrue(all.stream().flatMap(c -> c.methods().stream()).anyMatch(m -> m.id().matches("com\\.demo\\.service\\..*~0")));

        // экспорт -> те же пути и те же байты
        byte[] z = ProjectExporter.zip(p, true);
        Map<String, byte[]> out = new LinkedHashMap<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(z))) {
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) out.put(e.getName(), in.readAllBytes());
        }
        assertEquals(17 + 12, out.size());
        assertEquals("demo/", p.root());
        for (var u : ups) {
            String path = u.name();
            if (path.startsWith("demo/src/") || path.startsWith("demo/tests/")) assertArrayEquals(u.data(), out.get(path), path);
        }
        assertEquals(17, zipCount(ProjectExporter.zip(p, false)));
    }

    static int zipCount(byte[] z) throws IOException {
        int n = 0;
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(z))) {
            while (in.getNextEntry() != null) n++;
        }
        return n;
    }

    @Test
    void nestedClassAndOverloadIds() {
        var p = ProjectLoader.load(List.of(new ProjectLoader.Upload("a/A.java", b(
                "package a;\npublic class A {\n int f; A() {}\n void m() {}\n void m(int x) {}\n static class In { void run() {} }\n}\n"))));
        // обёртка "a/" совпадает с пакетом a: предупреждения быть не должно
        assertEquals(List.of(), p.warnings());
        var cls = TreeBuilder.build(p).get(0).files().get(0).classes();
        assertEquals("A", cls.get(0).name());
        assertEquals("a.A.m~1", cls.get(0).methods().get(1).id());
        assertEquals("a.A.<init>~0", cls.get(0).constructors().get(0).id());
        assertEquals("A$In", cls.get(1).name());
        assertEquals("a.A$In.run~0", cls.get(1).methods().get(0).id());
    }
}
