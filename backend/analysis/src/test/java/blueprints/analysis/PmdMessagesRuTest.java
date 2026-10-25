package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import net.sourceforge.pmd.lang.rule.Rule;
import net.sourceforge.pmd.lang.rule.RuleSetLoader;
import org.junit.jupiter.api.Test;

class PmdMessagesRuTest {
    static final Pattern CYRILLIC = Pattern.compile("[А-Яа-яЁё]");

    /** Словарь покрывает стандартный набор и quickstart PMD 7. */
    @Test
    void coversDefaultAndQuickstartRulesets() {
        RuleSetLoader loader = new RuleSetLoader();
        List<Rule> rules = new ArrayList<>(loader.loadFromString("d.xml", PmdDetector.DEFAULT_RULESET).getRules());
        rules.addAll(loader.loadFromResource("rulesets/java/quickstart.xml").getRules());
        List<String> missing = rules.stream().map(Rule::getName).filter(n -> !PmdMessagesRu.knows(n)).toList();
        assertTrue(missing.isEmpty(), missing.toString());
    }

    @Test
    void argumentsFromTemplate() {
        var t = PmdMessagesRu.translate("UnusedLocalVariable", "Avoid unused local variables such as ''{0}''.",
                "Avoid unused local variables such as 'x'.", "Правило PMD UnusedLocalVariable");
        assertEquals("Неиспользуемая локальная переменная «x»", t.message());
        assertEquals("Удалите переменную. Правило PMD UnusedLocalVariable", t.recommendation());
        assertEquals("Высокая когнитивная сложность «m()»: 20 при пороге 15", PmdMessagesRu.translate("CognitiveComplexity",
                "The {0} ''{1}'' has a cognitive complexity of {2}, current threshold is {3}",
                "The method 'm()' has a cognitive complexity of 20, current threshold is 15", "r").message());
        assertEquals("Имя поля «x» совпадает с именем метода", PmdMessagesRu.translate("AvoidFieldNameMatchingMethodName",
                "Field {0} has the same name as a method", "Field x has the same name as a method", "r").message());
        // сообщение не по шаблону — общий текст без конкретики
        assertEquals("Высокая когнитивная сложность", PmdMessagesRu.translate("CognitiveComplexity",
                "The {0} ''{1}'' has a cognitive complexity of {2}, current threshold is {3}", "something else", "r").message());
        assertEquals("Неиспользуемое закрытое поле", PmdMessagesRu.translate("UnusedPrivateField", null, "x", "r").message());
    }

    /** Шаблон из пользовательского ruleset: много токенов и несовпадение — без перебора (compute вне таймаута PMD). */
    @Test
    void hostileTemplateIsFast() {
        String template = "{0}a".repeat(40) + "{0}b";
        String text = "a".repeat(5_000);
        long t0 = System.nanoTime();
        var t = PmdMessagesRu.translate("UnusedLocalVariable", template, text, "r");
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertTrue(ms < 200, "разбор шёл " + ms + " мс");
        assertEquals("Неиспользуемая локальная переменная", t.message());
    }

    @Test
    void unknownRuleUnchanged() {
        var t = PmdMessagesRu.translate("NoSuchRule", "Some {0}", "Some English text 'q'", "Правило PMD NoSuchRule");
        assertEquals("Some English text 'q'", t.message());
        assertEquals("Правило PMD NoSuchRule", t.recommendation());
    }

    /** Находки PMD на demo со стандартным набором — по-русски; конкретика из сообщения PMD сохраняется. */
    @Test
    void demoFindingsInRussian() throws Exception {
        List<Issue> a = new PmdDetector().detectProject(ProjectAnalysis.of(ProjectAnalysisTest.demoFiles()));
        assertFalse(a.isEmpty());
        for (Issue i : a) {
            assertTrue(CYRILLIC.matcher(i.message()).find(), i.rule() + ": " + i.message());
            assertFalse(i.message().contains("{") || i.message().contains("["), i.rule() + ": " + i.message());
            assertTrue(i.recommendation().contains("Правило PMD " + i.rule()), i.recommendation());
        }
        String rs = PmdDetectorTest.ONE_RULE.replace("bestpractices.xml/UnusedLocalVariable", "codestyle.xml/UnnecessaryImport");
        List<Issue> imp = PmdDetectorTest.run(rs, "package p;\nimport java.util.List;\nclass A {}\n");
        assertEquals("Лишний import «java.util.List»", imp.get(0).message());
        List<Issue> unused = PmdDetectorTest.run(PmdDetectorTest.ONE_RULE, PmdDetectorTest.CODE);
        assertTrue(unused.stream().anyMatch(i -> i.message().equals("Неиспользуемая локальная переменная «x»")), unused.toString());
    }

    /** Правило вне словаря — английский текст PMD как есть. */
    @Test
    void unknownRuleInDetectorKeepsEnglish() {
        String rs = PmdDetectorTest.ONE_RULE.replace("bestpractices.xml/UnusedLocalVariable", "documentation.xml/CommentRequired");
        assertFalse(PmdMessagesRu.knows("CommentRequired"));
        List<Issue> issues = PmdDetectorTest.run(rs, "package p;\npublic class A {\n    public void m() {\n    }\n}\n");
        Issue i = issues.stream().filter(x -> x.rule().equals("CommentRequired")).findFirst().orElseThrow();
        assertFalse(CYRILLIC.matcher(i.message()).find(), i.message());
        assertTrue(i.recommendation().startsWith("Правило PMD CommentRequired"), i.recommendation());
    }
}
