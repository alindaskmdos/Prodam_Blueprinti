package blueprints.analysis;

import static blueprints.analysis.ProjectAnalysisTest.analyze;
import static blueprints.analysis.ProjectAnalysisTest.m;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.model.Span;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;

class LongLineTest {
    private static final Detector D = new LongLine();
    private static final String CHAIN = "        List<String> r = customers.stream().filter(c -> c.isActive()).map(c -> c.name())"
            + ".sorted().distinct().limit(10).toList();";
    private static final String ARGS = "        report.append(formatHeader(title, subtitle), formatBody(lines, widthOfTheColumnInChars), "
            + "formatFooter(total, \"a, (b)\"), 42);";
    private static final String ARRAY = "        int[] values = { firstValueOfTheTable, secondValueOfTheTable, thirdValueOfTheTable, "
            + "fourthValueOfTheTable, fifth };";

    @Test
    void longestLineWithCountAndReformattedAfter() {
        assertTrue(LongLine.width(CHAIN) > 120 && LongLine.width(ARGS) > 120);
        ProjectAnalysis p = analyze("class A {\n    void f() {\n" + CHAIN + "\n" + ARGS + "\n    }\n}\n");
        List<Issue> f = D.detect(m(p, "p.A.f~0"), p);
        assertEquals(1, f.size(), "одна находка на метод");
        Issue i = f.get(0);
        assertEquals("LongLine", i.rule());
        assertEquals("low", i.severity());
        assertEquals("high", i.confidence());
        int longest = LongLine.width(CHAIN) >= LongLine.width(ARGS) ? 5 : 6;
        assertEquals(new Span("src/p/F0.java", longest, longest), i.span(), "span — самая длинная строка");
        assertTrue(i.message().endsWith("строк длиннее порога в методе: 2"), i.message());
        assertNull(i.complexity());
        assertTrue(i.fixes().isEmpty());
        assertTrue(i.recommendation().contains("Стало:\n"), i.recommendation());
    }

    @Test
    void reformatOnlyInsertsLineBreaks() {
        for (String line : List.of(CHAIN, ARGS, ARRAY)) {
            String after = LongLine.reformat(line);
            assertNotNull(after, line);
            assertTrue(after.contains("\n"), after);
            for (String l : after.split("\n")) {
                assertTrue(LongLine.width(l) <= 120, l);
                assertTrue(l.startsWith("        "), "отступ исходной строки: " + l);
            }
            assertEquals(squeeze(line), squeeze(after), "токены не меняются");
        }
        String chain = LongLine.reformat(CHAIN);
        assertTrue(chain.startsWith(CHAIN.substring(0, CHAIN.indexOf(".filter"))), chain);
        assertTrue(chain.contains("\n                .filter("), chain);
        String args = LongLine.reformat(ARGS);
        assertTrue(args.contains("\n                formatFooter(total, \"a, (b)\"),\n"), args);
        assertTrue(LongLine.reformat(ARRAY).contains("\n                fifth };"), LongLine.reformat(ARRAY));
    }

    @Test
    void unsplittableLineGetsGeneralExample() {
        String line = "        int x = " + "a".repeat(130) + ";";
        assertNull(LongLine.reformat(line));
        ProjectAnalysis p = analyze("class A {\n    void f(int " + "a".repeat(130) + ") {\n" + line + "\n    }\n}\n");
        Issue i = D.detect(m(p, "p.A.f~0"), p).get(0);
        assertTrue(i.recommendation().contains("Пример:\n"), i.recommendation());
    }

    @Test
    void commentsLiteralsShortLinesAreSilent() {
        String lit = "        String sql = \"" + "select x from table where y = 1 and z = 2 ".repeat(4) + "\";";
        String comment = "        // " + "комментарий ".repeat(15);
        String tail = "        int x = 1; // " + "хвост ".repeat(25);
        String block = "         * " + "doc ".repeat(40);
        ProjectAnalysis p = analyze("class A {\n    void f() {\n" + lit + "\n" + comment + "\n" + tail + "\n        /*\n"
                + block + "\n         */\n        String t = \"\"\"\n            " + "text ".repeat(40) + "\n            \"\"\";\n"
                + "        int y = 2;\n    }\n}\n");
        assertTrue(D.detect(m(p, "p.A.f~0"), p).isEmpty());
    }

    @Test
    void tabCountsAsFour() {
        String line = "\t\t\t\tint v = " + "b".repeat(93) + ";"; // 106 символов, 118 с табами по 4
        assertEquals(118, LongLine.width(line));
        String longer = "\t\t\t\t\tint v = " + "b".repeat(93) + ";";
        assertEquals(122, LongLine.width(longer));
    }

    @Test
    void registeredAndOnDemo() throws IOException {
        assertTrue(DetectorRegistry.defaults().detectors().stream().anyMatch(d -> d instanceof LongLine));
        ProjectAnalysis demo = ProjectAnalysis.of(ProjectAnalysisTest.demoFiles());
        List<String> found = DetectorRegistry.defaults().run(demo).stream().filter(i -> i.rule().equals("LongLine"))
                .map(i -> i.methodId() + ":" + i.span().startLine()).toList();
        assertEquals(List.of("com.demo.service.ReportService.fullReport~0:80"), found);
    }

    /** Без пробельных символов вне строковых литералов. */
    private static String squeeze(String s) {
        StringBuilder sb = new StringBuilder();
        boolean in = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' && (i == 0 || s.charAt(i - 1) != '\\')) in = !in;
            if (in || !Character.isWhitespace(c)) sb.append(c);
        }
        return sb.toString();
    }
}
