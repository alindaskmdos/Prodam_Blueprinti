package blueprints.testing;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class NoiseTest {

    @Test
    void differingLinesAreNoisy() {
        assertEquals(List.of(), Noise.noisyLines("a\nb\n", "a\nb\n"));
        assertEquals(List.of(2), Noise.noisyLines("a\nt=1\nc\n", "a\nt=2\nc\n"));
        assertEquals(List.of(2), Noise.noisyLines("a\nb\r\n", "a\nb\n"), "CRLF ≠ LF, как в сравнении");
    }

    /** Разное число строк: строки без пары во втором прогоне — шумные, совпадающий префикс — нет. */
    @Test
    void differentLineCounts() {
        assertEquals(List.of(3, 4), Noise.noisyLines("a\nb\n", "a\nb\nc\nd\n"));
        assertEquals(List.of(2, 3), Noise.noisyLines("a\nx\ny\n", "a\n"));
        assertEquals(List.of(1), Noise.noisyLines("", "a\n"));
        assertEquals(List.of(2), Noise.noisyLines("a\nb", "a\nb\n"), "нет перевода строки в конце — другая строка");
    }

    private static TestResult io(String expected, List<Integer> noisy) {
        return new TestResult("t", "io", TestStatus.PASSED, 1, null, expected, expected, noisy);
    }

    @Test
    void mostlyNoiseIsStrictlyMoreThanHalf() {
        assertFalse(Noise.mostlyNoise(io("a\nb\nc\nd\n", List.of(1, 2))), "ровно половина — ещё не больше половины");
        assertTrue(Noise.mostlyNoise(io("a\nb\nc\nd\n", List.of(1, 2, 3))));
        assertFalse(Noise.mostlyNoise(io("a\nb\n", List.of())));
        // второй прогон длиннее: 2 строки эталона + 3 лишних шумных → 3 из 5
        assertTrue(Noise.mostlyNoise(io("a\nb\n", List.of(3, 4, 5))));
        assertFalse(Noise.mostlyNoise(io("a\nb\nc\n", List.of(4))), "1 из 4");
    }
}
