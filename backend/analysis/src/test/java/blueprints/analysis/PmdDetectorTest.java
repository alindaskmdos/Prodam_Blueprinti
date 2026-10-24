package blueprints.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import blueprints.model.Issue;
import blueprints.source.SourceFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class PmdDetectorTest {
    static final String ONE_RULE = """
            <?xml version="1.0"?>
            <ruleset name="t" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>t</description>
                <rule ref="category/java/bestpractices.xml/UnusedLocalVariable"/>
                <rule ref="category/java/errorprone.xml/EmptyCatchBlock"/>
            </ruleset>
            """;

    static final String CODE = """
            package p;
            class A {
                int f;
                void m() {
                    int x = 1;
                    try {
                        f++;
                    } catch (RuntimeException e) {
                    }
                }
            }
            """;

    static List<Issue> run(String ruleset, String code) {
        ProjectAnalysis p = ProjectAnalysis.of(List.of(new SourceFile("src/p/A.java", "p", code.getBytes(StandardCharsets.UTF_8))));
        return new PmdDetector(ruleset).detectProject(p);
    }

    @Test
    void violationsBoundToMethodByLine() {
        List<Issue> issues = run(ONE_RULE, CODE);
        assertEquals(Set.of("UnusedLocalVariable", "EmptyCatchBlock"), issues.stream().map(Issue::rule).collect(Collectors.toSet()));
        Issue unused = issues.stream().filter(i -> i.rule().equals("UnusedLocalVariable")).findFirst().orElseThrow();
        assertEquals("PMD", unused.source());
        assertEquals("p.A.m~0", unused.methodId());
        assertEquals(5, unused.span().startLine());
        assertEquals("src/p/A.java", unused.span().file());
        assertNull(unused.blockId());
        assertNull(unused.classIds());
        assertTrue(unused.fixes().isEmpty());
        assertEquals(issues.size(), issues.stream().map(Issue::id).distinct().count());
    }

    /** Стандартный набор не дублирует наши детекторы: неиспользуемая локальная и пустой catch молчат. */
    @Test
    void defaultRulesetHasNoOverlapWithOwnDetectors() {
        List<Issue> issues = run(PmdDetector.DEFAULT_RULESET, CODE);
        assertTrue(issues.stream().noneMatch(i -> Set.of("UnusedLocalVariable", "EmptyCatchBlock").contains(i.rule())), issues.toString());
        assertTrue(run(PmdDetector.DEFAULT_RULESET, """
                package p;
                class A {
                    String s(String[] a) { String r = ""; for (String x : a) r += x; return r; }
                    private void dead() {}
                }
                """).stream().noneMatch(i -> Set.of("UseStringBufferForStringAppends", "UnusedPrivateMethod").contains(i.rule())));
    }

    @Test
    void classLevelViolationGetsClassIds() {
        String rs = ONE_RULE.replace("bestpractices.xml/UnusedLocalVariable", "bestpractices.xml/UnusedPrivateField");
        List<Issue> issues = run(rs, "package p;\nclass A {\n    private int x;\n}\n");
        assertEquals(1, issues.size(), issues.toString());
        assertNull(issues.get(0).methodId());
        assertEquals(List.of("p.A"), issues.get(0).classIds());
        assertEquals(3, issues.get(0).span().startLine());
    }

    @Test
    void defaultRulesetIsValid() {
        PmdDetector.validate(PmdDetector.DEFAULT_RULESET); // совпадение с фикстурой контракта — ContractConformanceTest в app
    }

    @Test
    void brokenXmlHasLine() {
        var e = assertThrows(PmdDetector.InvalidRulesetException.class,
                () -> PmdDetector.validate("<?xml version=\"1.0\"?>\n<ruleset>\n  <rule ref=\"category/java/errorprone.xml\">\n</ruleset>\n"));
        assertEquals(4, e.line());
    }

    @Test
    void unknownRuleRejected() {
        var e = assertThrows(PmdDetector.InvalidRulesetException.class,
                () -> PmdDetector.validate(ONE_RULE.replace("UnusedLocalVariable", "NoSuchRule")));
        assertTrue(e.getMessage().contains("Unable to find rule 'NoSuchRule'"), e.getMessage());
        assertEquals(4, e.line());
    }

    @Test
    void notRulesetRejected() {
        var e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate("<?xml version=\"1.0\"?>\n<beans/>"));
        assertEquals(2, e.line());
    }

    /** Ссылки только на classpath PMD: файлы, URL, свои классы и DOCTYPE (XXE) отклоняются до загрузки. */
    @Test
    void externalReferencesRejected() {
        for (String bad : List.of("file:///etc/passwd", "/etc/passwd", "https://example.com/r.xml", "category/../../x.xml",
                "C:\\\\x.xml")) {
            var e = assertThrows(PmdDetector.InvalidRulesetException.class,
                    () -> PmdDetector.validate(ONE_RULE.replace("category/java/errorprone.xml/EmptyCatchBlock", bad)), bad);
            assertEquals(5, e.line(), bad);
        }
        assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(ONE_RULE.replace(
                "<rule ref=\"category/java/errorprone.xml/EmptyCatchBlock\"/>",
                "<rule name=\"X\" class=\"java.lang.Thread\" message=\"m\"/>")));
        assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(
                "<?xml version=\"1.0\"?>\n<!DOCTYPE r [<!ENTITY x SYSTEM \"file:///etc/passwd\">]>\n<ruleset>&x;</ruleset>"));
    }

    /** XPath-правило с файлами/URL (Saxon: unparsed-text, doc…): свои правила и подмена xpath у ссылок отклоняются со строкой. */
    static final String XPATH_FILE = """
            <?xml version="1.0"?>
            <ruleset name="t" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>t</description>
                <rule name="Leak" language="java" message="m" class="net.sourceforge.pmd.lang.rule.xpath.XPathRule">
                    <priority>1</priority>
                    <properties>
                        <property name="xpath"><value><![CDATA[//ClassDeclaration[unparsed-text('file:///etc/passwd') != '']]]></value></property>
                    </properties>
                </rule>
            </ruleset>
            """;

    static final String XPATH_OVERRIDE = """
            <?xml version="1.0"?>
            <ruleset name="t" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                <description>t</description>
                <rule ref="category/java/bestpractices.xml/UnusedLocalVariable">
                    <properties>
                        <property name="xpath" value="//ClassDeclaration[doc-available('http://169.254.169.254/')]"/>
                    </properties>
                </rule>
            </ruleset>
            """;

    @Test
    void customXpathRejected() {
        var e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(XPATH_FILE));
        assertEquals(4, e.line());
        // атрибут с xpath в имени на любом элементе (PMD 7.28 его игнорирует, но не принимаем)
        e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(ONE_RULE.replace(
                "<rule ref=\"category/java/errorprone.xml/EmptyCatchBlock\"/>",
                "<rule ref=\"category/java/errorprone.xml/EmptyCatchBlock\" violationSuppressXPath=\"doc('http://169.254.169.254/latest')\"/>")));
        assertEquals(5, e.line());
        e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(ONE_RULE.replace(
                "<description>", "<description xmlns:p=\"urn:x\" p:XPath=\"1\">")));
        assertEquals(3, e.line());
        e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(XPATH_OVERRIDE));
        assertEquals(6, e.line());
        String suppress = XPATH_OVERRIDE.replace("name=\"xpath\"", "name=\"violationSuppressXPath\"");
        e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(suppress));
        assertEquals(6, e.line());
        e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(suppress
                .replace("<property name=\"violationSuppressXPath\" value=", "<property><name>ViolationSuppressXPATH</name><value>x</value></property><property name=\"y\" value=")));
        assertEquals(6, e.line());
        // обычное свойство без xpath в имени проходит
        PmdDetector.validate(XPATH_OVERRIDE.replace("<property name=\"xpath\" value=\"//ClassDeclaration[doc-available('http://169.254.169.254/')]\"/>",
                "<property name=\"violationSuppressRegex\" value=\"foo\"/>"));
    }

    /** Нарушение вне классов (лишний import) — к первому классу файла. */
    @Test
    void outsideClassBoundToFirstClass() {
        String rs = ONE_RULE.replace("bestpractices.xml/UnusedLocalVariable", "codestyle.xml/UnnecessaryImport");
        List<Issue> issues = run(rs, "package p;\nimport java.util.List;\nclass A {}\nclass B {}\n");
        assertEquals(1, issues.size(), issues.toString());
        assertEquals("UnnecessaryImport", issues.get(0).rule());
        assertNull(issues.get(0).methodId());
        assertEquals(List.of("p.A"), issues.get(0).classIds());
        assertEquals(2, issues.get(0).span().startLine());
        assertTrue(run(rs, "package p;\nimport java.util.List;\n").isEmpty()); // файл без классов — не к чему привязать
    }

    /** Пролог только UTF-8: checkXml и PMD читают одни и те же UTF-8 байты. */
    @Test
    void nonUtf8EncodingRejected() {
        var e = assertThrows(PmdDetector.InvalidRulesetException.class,
                () -> PmdDetector.validate(ONE_RULE.replace("<?xml version=\"1.0\"?>", "<?xml version=\"1.0\" encoding=\"UTF-16\"?>")));
        assertEquals(1, e.line());
        assertThrows(PmdDetector.InvalidRulesetException.class,
                () -> PmdDetector.validate(ONE_RULE.replace("<?xml version=\"1.0\"?>", "<?xml version='1.0' encoding='ISO-8859-1'?>")));
        PmdDetector.validate(ONE_RULE.replace("<?xml version=\"1.0\"?>", "<?xml version=\"1.0\" encoding=\"utf-8\"?>"));
    }

    /** PMD ищет ссылку сначала как файл относительно рабочей папки — файл с путём ссылки не принимаем. */
    @Test
    void refShadowedByLocalFileRejected() throws Exception {
        // уникальное имя; удаляем только своё (папку category/ — только если создали её сами)
        Path dir = Path.of("category");
        boolean createdDir = !Files.exists(dir);
        Path f = dir.resolve("bp-shadow-" + UUID.randomUUID().toString().replace("-", "") + ".xml");
        Files.createDirectories(dir);
        Files.writeString(f, "<ruleset/>");
        try {
            var e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(ONE_RULE.replace(
                    "category/java/errorprone.xml/EmptyCatchBlock", "category/" + f.getFileName() + "/X")));
            assertEquals(5, e.line());
            assertTrue(e.getMessage().contains("файлом"), e.getMessage());
        } finally {
            Files.deleteIfExists(f);
            if (createdDir) {
                try {
                    Files.deleteIfExists(dir);
                } catch (DirectoryNotEmptyException ignored) {
                    // кто-то положил туда своё — не трогаем
                }
            }
        }
    }

    /** Ждёт, пока зависшие (по таймауту) прогоны освободят пул: regex не прерывается, но конечна. */
    static void awaitIdlePool() throws InterruptedException {
        long end = System.nanoTime() + 120_000_000_000L;
        while (PmdDetector.PERMITS.availablePermits() < 2 && System.nanoTime() < end) Thread.sleep(50);
        assertEquals(2, PmdDetector.PERMITS.availablePermits(), "прогоны PMD не освободились");
    }

    /**
     * ReDoS в regex-свойстве: прогон PMD обрывается по таймауту, анализ без находок PMD, остальные детекторы на месте;
     * ruleset попадает в список неудач — больше не запускается, validate его отклоняет.
     */
    @Test
    void catastrophicRegexTimesOut() throws InterruptedException {
        String rs = """
                <?xml version="1.0"?>
                <ruleset name="r" xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">
                    <description>r</description>
                    <rule ref="category/java/codestyle.xml/FieldNamingConventions">
                        <properties><property name="defaultFieldPattern" value="(.*a){12}$"/></properties>
                    </rule>
                </ruleset>
                """;
        PmdDetector.validate(rs);
        // (a+)+$ Java 21 не «взрывает» (оптимизация вложенных квантификаторов); (.*a){12}$ — ~n^12 шагов:
        // на 29 «a» несколько секунд, конечно — зависший поток пула потом освободится
        String code = "package p;\nclass A {\n    int " + "a".repeat(29) + "b;\n"
                + "    int m(int[] x) { int s = 0; for (int i : x) for (int j : x) s += i * j; return s; }\n}\n";
        ProjectAnalysis p = ProjectAnalysis.of(List.of(new SourceFile("src/p/A.java", "p", code.getBytes(StandardCharsets.UTF_8))));
        Duration before = PmdDetector.timeout;
        PmdDetector.timeout = Duration.ofSeconds(1);
        try {
            awaitIdlePool();
            long t0 = System.nanoTime();
            List<Issue> all = DetectorRegistry.defaults(rs).run(p);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertTrue(ms < 5_000, "анализ шёл " + ms + " мс");
            assertTrue(all.stream().noneMatch(i -> "PMD".equals(i.source())), all.toString());
            assertTrue(all.stream().anyMatch(i -> i.rule().equals("NestedLoopSameCollection")), all.toString());
            // список неудач: тот же ruleset больше не запускается (сразу пусто, пул не занимается) и не проходит validate
            int permits = PmdDetector.PERMITS.availablePermits();
            ProjectAnalysis other = ProjectAnalysis.of(List.of(new SourceFile("src/p/B.java", "p",
                    "package p;\nclass B {}\n".getBytes(StandardCharsets.UTF_8))));
            PmdDetector again = new PmdDetector(rs);
            t0 = System.nanoTime();
            assertTrue(again.detectProject(other).isEmpty());
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 2_000, "ruleset с таймаутом запущен снова");
            assertTrue(PmdDetector.PERMITS.availablePermits() >= permits, "ruleset с таймаутом занял поток");
            var e = assertThrows(PmdDetector.InvalidRulesetException.class, () -> PmdDetector.validate(rs));
            assertTrue(e.getMessage().contains("не уложился"), e.getMessage());
            // пул не заклинило навсегда: обычный ruleset отвечает, когда зависший прогон закончится
            awaitIdlePool();
            PmdDetector.timeout = Duration.ofSeconds(60);
            assertTrue(run(ONE_RULE + "<!-- after-timeout -->", CODE).stream().anyMatch(i -> "PMD".equals(i.source())));
        } finally {
            PmdDetector.timeout = before;
        }
    }

    /** Все потоки пула заняты: прогон сразу без находок PMD (без ожидания и без кэша), validate — отдельное сообщение. */
    @Test
    void busyPoolSkipsImmediately() throws Exception {
        awaitIdlePool();
        String rs = ONE_RULE + "<!-- busy-pool -->"; // свой текст — мимо кэша результатов
        ProjectAnalysis p = ProjectAnalysis.of(List.of(new SourceFile("src/p/A.java", "p", CODE.getBytes(StandardCharsets.UTF_8))));
        PmdDetector d = new PmdDetector(rs);
        PmdDetector.PERMITS.acquire(2); // оба прогона «заняты»
        try {
            long t0 = System.nanoTime();
            assertTrue(d.detectProject(p).isEmpty());
            assertTrue((System.nanoTime() - t0) / 1_000_000 < 2_000, "ждал свободный поток");
            var e = assertThrows(PmdDetector.BusyException.class, () -> PmdDetector.validate(rs));
            assertTrue(e.getMessage().contains("занят"), e.getMessage());
        } finally {
            PmdDetector.PERMITS.release(2);
        }
        awaitIdlePool();
        // занятость пула не попадает ни в кэш, ни в список неудач: корректный ruleset сохраняется и находит
        PmdDetector.validate(rs);
        assertTrue(run(rs, CODE).stream().anyMatch(i -> "PMD".equals(i.source())));
    }

    /** Сбой PMD при прогоне (ruleset не загрузился — напр. ref подменили после validate) — без находок PMD, снимок не падает. */
    @Test
    void pmdFailureGivesNoPmdIssues() throws Exception {
        awaitIdlePool();
        String rs = ONE_RULE.replace("UnusedLocalVariable", "NoSuchRuleAfterValidate"); // конструктор не проверяет ruleset
        ProjectAnalysis p = ProjectAnalysis.of(List.of(new SourceFile("src/p/A.java", "p",
                ("package p;\nclass A { int m(int[] x) { int s = 0; for (int i : x) for (int j : x) s += i * j; return s; } }\n")
                        .getBytes(StandardCharsets.UTF_8))));
        List<Issue> all = DetectorRegistry.defaults(rs).run(p);
        assertTrue(all.stream().noneMatch(i -> "PMD".equals(i.source())), all.toString());
        assertTrue(all.stream().anyMatch(i -> i.rule().equals("NestedLoopSameCollection")), all.toString());
        // подложенный файл с путём ref, появившийся после validate: повторный checkXml в load — тоже без PMD, без исключения
        Path dir = Path.of("category");
        boolean createdDir = !Files.exists(dir);
        Path f = dir.resolve("bp-late-" + UUID.randomUUID().toString().replace("-", "") + ".xml");
        Files.createDirectories(dir);
        Files.writeString(f, "<ruleset/>");
        try {
            String shadow = ONE_RULE.replace("category/java/errorprone.xml/EmptyCatchBlock", "category/" + f.getFileName() + "/X");
            assertTrue(new PmdDetector(shadow).detectProject(p).isEmpty());
        } finally {
            Files.deleteIfExists(f);
            if (createdDir) {
                try {
                    Files.deleteIfExists(dir);
                } catch (DirectoryNotEmptyException ignored) {
                    // чужое — не трогаем
                }
            }
        }
        assertEquals(2, PmdDetector.PERMITS.availablePermits());
    }

    /** Поток запроса прерван до/во время ожидания: задача может быть отменена до старта — разрешение всё равно возвращается. */
    @Test
    void interruptedCallerReturnsPermit() throws Exception {
        awaitIdlePool();
        ProjectAnalysis p = ProjectAnalysis.of(List.of(new SourceFile("src/p/A.java", "p", CODE.getBytes(StandardCharsets.UTF_8))));
        for (int i = 0; i < 5; i++) {
            PmdDetector d = new PmdDetector(ONE_RULE + "<!-- interrupted-" + i + " -->"); // мимо кэша
            Thread.currentThread().interrupt(); // f.get сразу бросит InterruptedException
            try {
                assertTrue(d.detectProject(p).isEmpty());
                assertTrue(Thread.interrupted(), "флаг interrupt не восстановлен"); // и сбрасываем его
            } finally {
                Thread.interrupted();
            }
        }
        awaitIdlePool(); // ждёт до 120 с: запущенные тела отпускают сами, отменённые до старта — вызывающий
    }

    /** demo со стандартным набором: находки есть, каждая привязана к методу или классу, порядок стабилен. */
    @Test
    void demoWithDefaultRuleset() throws Exception {
        var files = ProjectAnalysisTest.demoFiles();
        List<Issue> a = new PmdDetector().detectProject(ProjectAnalysis.of(files));
        assertTrue(!a.isEmpty());
        assertTrue(a.stream().allMatch(i -> i.source().equals("PMD") && (i.methodId() != null || i.classIds() != null)), a.toString());
        assertTrue(a.stream().anyMatch(i -> i.methodId() != null));
        assertEquals(a.size(), a.stream().map(Issue::id).distinct().count());
        assertEquals(a, new PmdDetector(PmdDetector.DEFAULT_RULESET + " ").detectProject(ProjectAnalysis.of(files))); // мимо кэша
    }

    @Test
    void registeredInDefaults() {
        assertTrue(DetectorRegistry.defaults(PmdDetector.DEFAULT_RULESET).detectors().stream().anyMatch(d -> d instanceof PmdDetector));
    }
}
