package blueprints.cli;

import static blueprints.cli.CliTest.DEMO;
import static blueprints.cli.CliTest.run;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** verify на реальном Docker. Пропускается, если docker info не проходит. */
class VerifyDockerTest {

    @Test
    void demoIsGreen() throws Exception {
        assumeTrue(Verify.dockerUp(), "Docker недоступен");
        CliTest.Run r = run("verify", DEMO, "--format", "json");
        assertEquals(Cli.OK, r.code(), r.out() + r.err());
        JsonNode j = new ObjectMapper().readTree(r.out());
        assertEquals("green", j.get("status").asText());
        assertEquals(6, j.get("results").size());
        for (JsonNode t : j.get("results")) assertEquals("passed", t.get("status").asText(), t.toString());
    }

    @Test
    void wrongExpectedOutputIsViolation(@TempDir Path dir) throws Exception {
        assumeTrue(Verify.dockerUp(), "Docker недоступен");
        Files.writeString(dir.resolve("Main.java"), "public class Main { public static void main(String[] a) { System.out.println(1); } }");
        Files.createDirectories(dir.resolve("tests"));
        Files.writeString(dir.resolve("tests/one.in"), "");
        Files.writeString(dir.resolve("tests/one.out"), "2\n");
        CliTest.Run r = run("verify", dir.toString());
        assertEquals(Cli.VIOLATION, r.code(), r.out() + r.err());
        assertTrue(r.out().contains("Проверка: red"), r.out());
    }

    @Test
    void noDockerIsSandboxError() {
        String saved = Verify.dockerBinary;
        Verify.dockerBinary = "blueprints-no-such-docker";
        try {
            CliTest.Run r = run("verify", DEMO);
            assertEquals(Cli.SANDBOX_ERROR, r.code(), r.err());
            assertTrue(r.err().contains("Docker недоступен"), r.err());
        } finally {
            Verify.dockerBinary = saved;
        }
    }

    @Test
    void verifyLoadError(@TempDir Path dir) {
        assertEquals(Cli.LOAD_ERROR, run("verify", dir.toString()).code());
    }
}
