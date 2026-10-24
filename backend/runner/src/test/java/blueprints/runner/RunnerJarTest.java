package blueprints.runner;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.jar.Attributes;
import java.util.jar.JarInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RunnerJarTest {
    @Test
    void jarRunsWithJavaAndHasNoRewrite(@TempDir Path dir) throws Exception {
        Map<String, String> src = Map.of(
                "src/a/Main.java", "package a; public class Main { public static void main(String[] x) {"
                        + " double d = Math.random(); System.out.print(\"hi \" + new java.util.Scanner(System.in).next()); } }",
                "src/a/B.java", "package a; class B {}");
        Runner.JarResult r = Runner.jar(src, null);
        assertEquals(List.of(), r.diagnostics());
        List<String> entries = new ArrayList<>();
        try (var in = new JarInputStream(new ByteArrayInputStream(r.jar()))) {
            assertEquals("a.Main", in.getManifest().getMainAttributes().get(Attributes.Name.MAIN_CLASS));
            for (var e = in.getNextJarEntry(); e != null; e = in.getNextJarEntry()) entries.add(e.getName());
        }
        assertEquals(List.of("a/B.class", "a/Main.class"), entries); // без bp/rt/Seed: seed не применяется

        Path jar = Files.write(dir.resolve("p.jar"), r.jar());
        Process p = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(), "-jar", jar.toString())
                .redirectErrorStream(true).start();
        p.getOutputStream().write("you\n".getBytes(StandardCharsets.UTF_8));
        p.getOutputStream().close();
        assertEquals("hi you", new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
        assertEquals(0, p.waitFor());
    }

    @Test
    void compileErrorsAndMainChoice() {
        Runner.JarResult bad = Runner.jar(Map.of("A.java", "class A { public static void main(String[] x) { nope(); } }"), "A");
        assertNull(bad.jar());
        assertTrue(bad.diagnostics().get(0).startsWith("A.java:1: "), bad.diagnostics().toString());
        Map<String, String> two = Map.of("A.java", "class A { public static void main(String[] x) {} }",
                "B.java", "class B { public static void main(String[] x) {} }");
        assertThrows(IllegalArgumentException.class, () -> Runner.jar(two, null));
        assertNotNull(Runner.jar(two, "B").jar());
    }
}
