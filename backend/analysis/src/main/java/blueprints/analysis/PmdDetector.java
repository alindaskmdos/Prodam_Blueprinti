package blueprints.analysis;

import blueprints.model.Issue;
import blueprints.model.Span;
import blueprints.source.SourceFile;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.MessageFormat;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParserFactory;
import net.sourceforge.pmd.PMDConfiguration;
import net.sourceforge.pmd.PmdAnalysis;
import net.sourceforge.pmd.lang.LanguageRegistry;
import net.sourceforge.pmd.lang.document.FileId;
import net.sourceforge.pmd.lang.rule.RuleSet;
import net.sourceforge.pmd.lang.rule.RuleSetLoader;
import net.sourceforge.pmd.reporting.RuleViolation;
import net.sourceforge.pmd.util.log.PmdReporter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.Locator;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;
import org.xml.sax.helpers.DefaultHandler;

/**
 * Адаптер PMD (§14а.2): прогоняет PMD 7 по исходникам проекта с ruleset из {@code .blueprints/pmd-ruleset.xml}
 * (или стандартным {@link #DEFAULT_RULESET}). Находки — source=PMD, rule = имя правила PMD; привязка по строке начала:
 * самый вложенный метод файла → methodId (blockId подставит app), иначе самый вложенный класс (вне классов — первый класс файла)
 * → classIds; в файле без классов находка отбрасывается.
 * Ruleset только из classpath PMD (category/…, rulesets/…): без сети и файлов, без своих правил (class, в т.ч. XPathRule) и свойства xpath.
 */
public final class PmdDetector implements Detector {
    public static final String SOURCE = "PMD";
    /** Стандартный набор (без правил, дублирующих наши детекторы) — тот же текст, что в contract/fixtures/pmd-config.default.json. */
    public static final String DEFAULT_RULESET = resource("pmd-ruleset.xml");

    private static final Pattern ENCODING = Pattern.compile("\\A\\uFEFF?\\s*<\\?xml[^>]*?encoding\\s*=\\s*[\"']([^\"']*)[\"']");
    private static final Pattern REF = Pattern.compile("(category|rulesets)/[A-Za-z0-9_\\-]+(/[A-Za-z0-9_\\-]+)*\\.xml(/[A-Za-z0-9_]+)?");
    private static final Pattern LINE = Pattern.compile("pmd-ruleset\\.xml:(\\d+)");

    private static final int CACHE_SIZE = 32;
    private static final Map<String, List<Issue>> CACHE = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, List<Issue>> eldest) {
            return size() > CACHE_SIZE;
        }
    };

    /** Ограничение прогона PMD по умолчанию: первый прогон в JVM ~6 с. */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(15);
    /** Тесты уменьшают. */
    static volatile Duration timeout = DEFAULT_TIMEOUT;
    private static final int WORKERS = 2;
    /** Без очереди (SynchronousQueue): нет свободного потока — задача отклоняется сразу, а не ждёт таймаут в очереди. */
    /** Вход в прогон — только через разрешение; освобождается, когда задача реально закончилась (зависшая regex держит его). */
    static final Semaphore PERMITS = new Semaphore(WORKERS);
    /** Потоков столько, сколько разрешений в работе (+ простаивающие до 60 с); сам пул не ограничивает — ограничивает PERMITS. */
    private static final ExecutorService POOL = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "pmd");
        t.setDaemon(true);
        return t;
    });
    /** SHA-256 ruleset'ов, на которых был таймаут: больше не запускаются (кроме стандартного — в нём нет пользовательских regex). */
    private static final Map<String, Boolean> FAILED = new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > CACHE_SIZE;
        }
    };
    private static final Logger LOG = LoggerFactory.getLogger(PmdDetector.class);

    private final String ruleset;

    /** Стандартный набор. */
    public PmdDetector() {
        this(DEFAULT_RULESET);
    }

    /** xml — ruleset проекта; должен пройти {@link #validate}. */
    public PmdDetector(String ruleset) {
        this.ruleset = ruleset;
    }

    /** Ruleset не проверен: все потоки PMD заняты (или ожидание прервано) — дело не в ruleset, повторить позже. */
    public static final class BusyException extends InvalidRulesetException {
        BusyException() {
            super("анализатор PMD сейчас занят другими прогонами — повторите сохранение позже", null);
        }
    }

    /** Неверный ruleset: line — строка XML с 1 или null. */
    public static class InvalidRulesetException extends RuntimeException {
        private final Integer line;

        InvalidRulesetException(String message, Integer line) {
            super(message);
            this.line = line;
        }

        public Integer line() {
            return line;
        }
    }

    @Override
    public String id() {
        return SOURCE;
    }

    @Override
    public List<Issue> detect(MethodAnalysis method, ProjectAnalysis project) {
        return List.of();
    }

    /**
     * Находки по ruleset и исходникам проекта.
     * ponytail: LRU на {@link #CACHE_SIZE} снимков по SHA-256 ruleset+исходников — PMD ~1 с на прогон, а app строит снимок на каждый GET.
     */
    @Override
    public List<Issue> detectProject(ProjectAnalysis project) {
        String key = key(ruleset, project.files());
        synchronized (CACHE) {
            List<Issue> hit = CACHE.get(key);
            if (hit != null) return hit;
        }
        List<RuleViolation> violations = runLimited(project.files());
        if (violations == null) return List.of(); // таймаут / пул занят / ruleset в чёрном списке: без находок PMD и без кэша
        List<Issue> out = List.copyOf(compute(project, violations));
        synchronized (CACHE) {
            CACHE.put(key, out);
        }
        return out;
    }

    private List<Issue> compute(ProjectAnalysis project, List<RuleViolation> found) {
        List<Issue> out = new ArrayList<>();
        Map<String, Integer> seen = new LinkedHashMap<>();
        List<MethodAnalysis> methods = project.methods();
        List<String> paths = project.files().stream().map(SourceFile::path).toList();
        // порядок отчёта PMD не гарантирован; сортируем как файлы проекта, затем по позиции
        List<RuleViolation> violations = new ArrayList<>(found);
        violations.sort(Comparator.<RuleViolation>comparingInt(v -> paths.indexOf(v.getFileId().getOriginalPath()))
                .thenComparingInt(RuleViolation::getBeginLine).thenComparingInt(RuleViolation::getBeginColumn)
                .thenComparing(v -> v.getRule().getName()).thenComparing(RuleViolation::getDescription));
        for (RuleViolation v : violations) {
            String file = v.getFileId().getOriginalPath();
            int line = v.getBeginLine();
            MethodAnalysis m = methods.stream()
                    .filter(x -> x.file().equals(file) && contains(x.span(), line))
                    .min(Comparator.comparingInt(x -> x.span().endLine() - x.span().startLine())).orElse(null);
            UmlModel.Clazz c = m != null ? null : project.uml().classes().stream()
                    .filter(x -> x.path().equals(file) && contains(x.span(), line))
                    .min(Comparator.comparingInt(x -> x.span().endLine() - x.span().startLine())).orElse(null);
            String rule = v.getRule().getName();
            // вне классов (import, package): первый класс файла; файл без классов — находку не к чему привязать
            if (m == null && c == null) c = project.uml().classes().stream().filter(x -> x.path().equals(file)).findFirst().orElse(null);
            if (m == null && c == null) continue;
            String where = m != null ? m.id() : c.id();
            String id = SOURCE + ":" + rule + ":" + where + ":" + line + ":" + v.getBeginColumn();
            int n = seen.merge(id, 1, Integer::sum);
            if (n > 1) id += "#" + n;
            String url = v.getRule().getExternalInfoUrl();
            out.add(new Issue(id, rule, severity(v.getRule().getPriority().getPriority()), "high", SOURCE,
                    new Span(file, line, Math.max(line, v.getEndLine())), m != null ? m.id() : null, null,
                    v.getDescription(), "Правило PMD " + rule + (url == null || url.isBlank() ? "" : ": " + url),
                    null, List.of(), m == null ? List.of(c.id()) : null));
        }
        return out;
    }

    private static String key(String ruleset, List<SourceFile> files) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            d.update(ruleset.getBytes(StandardCharsets.UTF_8));
            for (SourceFile f : files) {
                d.update((byte) 0);
                d.update(f.path().getBytes(StandardCharsets.UTF_8));
                d.update((byte) 0);
                d.update(f.content());
            }
            return HexFormat.of().formatHex(d.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Приоритет PMD 1–2 → high, 3 → medium, 4–5 → low. */
    static String severity(int priority) {
        return priority <= 2 ? "high" : priority == 3 ? "medium" : "low";
    }

    /** Проверка ruleset до сохранения: XML без DOCTYPE, ссылки только на правила из classpath PMD, загрузка самим PMD. */
    public static void validate(String xml) {
        checkXml(xml);
        if (failed(xml)) throw new InvalidRulesetException("на этом ruleset PMD уже не уложился в " + timeout.toMillis()
                + " мс (вероятно, тяжёлая регулярка в свойствах или include/exclude-pattern) — исправьте его", null);
        // загрузка компилирует include/exclude-pattern и regex-свойства — тоже под таймаутом
        try {
            if (limited(() -> load(xml)) != null) return;
        } catch (RejectedExecutionException | CancellationException e) {
            throw new BusyException();
        }
        markFailed(xml);
        throw new InvalidRulesetException("ruleset PMD загружается дольше " + timeout.toMillis() + " мс", null);
    }

    /**
     * Прогон PMD с ограничением {@link #timeout} (защита от ReDoS в regex-свойствах правил) или null: таймаут (ruleset — в список
     * неудач), нет свободного разрешения, ruleset уже в списке неудач, сбой PMD. Одновременно — не больше {@link #WORKERS} прогонов (семафор):
     * java.util.regex не реагирует на interrupt, зависший поток не убить, поэтому их число ограничено пулом, а не растёт с запросами.
     * ponytail: если все потоки пула зависли навсегда — PMD молчит до рестарта, остальной анализ работает; надёжнее — отдельный процесс.
     */
    private List<RuleViolation> runLimited(List<SourceFile> files) {
        if (failed(ruleset)) return null;
        List<RuleViolation> found;
        try {
            found = limited(() -> run(ruleset, files));
        } catch (RejectedExecutionException e) {
            LOG.warn("PMD: все {} потока заняты — анализ без находок PMD", WORKERS);
            return null;
        } catch (CancellationException e) {
            return null; // ожидание прервано (флаг interrupt восстановлен) — не неудача ruleset
        } catch (RuntimeException e) {
            // сбой PMD (ruleset не загрузился, подложенный ref, Error внутри PMD) не должен ронять весь снимок — анализ без PMD
            LOG.warn("PMD: прогон упал — анализ без находок PMD: {}", e.toString());
            return null;
        }
        if (found == null) {
            LOG.warn("PMD: прогон дольше {} мс — анализ без находок PMD (вероятно, тяжёлая регулярка в ruleset)", timeout.toMillis());
            markFailed(ruleset);
        }
        return found;
    }

    private static boolean failed(String xml) {
        synchronized (FAILED) {
            return FAILED.containsKey(key(xml, List.of()));
        }
    }

    /** Стандартный набор не запоминается: его таймаут — от размера проекта, а не от ReDoS. */
    private static void markFailed(String xml) {
        if (xml.equals(DEFAULT_RULESET)) return;
        synchronized (FAILED) {
            FAILED.put(key(xml, List.of()), Boolean.TRUE);
        }
    }

    /**
     * Задача в пуле PMD с ограничением {@link #timeout}; null — не уложилась (поток прерван, но regex может доработать).
     * Нет свободного разрешения — {@link RejectedExecutionException}; прерван вызывающий поток — {@link CancellationException}
     * (флаг interrupt восстановлен); ошибка задачи — RuntimeException (Error обёрнут в IllegalStateException).
     */
    private static <T> T limited(Callable<T> task) {
        if (!PERMITS.tryAcquire()) throw new RejectedExecutionException("все потоки PMD заняты");
        // кто «забрал» задачу, тот и отпускает разрешение: тело (release в своём finally) или вызывающий, если отменил до старта
        AtomicBoolean claimed = new AtomicBoolean();
        Future<T> f;
        try {
            f = POOL.submit(() -> {
                if (!claimed.compareAndSet(false, true)) return null; // отменено до старта — разрешение отпустил вызывающий
                try {
                    return task.call();
                } finally {
                    PERMITS.release();
                }
            });
        } catch (RuntimeException e) {
            PERMITS.release();
            throw e;
        }
        try {
            return f.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CancellationException("ожидание PMD прервано");
        } catch (ExecutionException e) {
            throw e.getCause() instanceof RuntimeException r ? r : new IllegalStateException(e.getCause());
        } finally {
            if (!f.isDone()) f.cancel(true);
            if (claimed.compareAndSet(false, true)) PERMITS.release(); // тело не запускалось и уже не запустится
        }
    }

    private static List<RuleViolation> run(String xml, List<SourceFile> files) {
        PMDConfiguration config = config();
        config.setThreads(0); // анализ в потоке пула, без своих потоков PMD
        try (PmdAnalysis pmd = PmdAnalysis.create(config)) {
            pmd.addRuleSet(load(xml));
            for (SourceFile f : files) pmd.files().addSourceFile(FileId.fromPathLikeString(f.path()), f.text());
            return pmd.performAnalysisAndCollectReport().getViolations();
        }
    }

    private static RuleSet load(String xml) {
        checkXml(xml); // повторно перед загрузкой: подложенный файл ref мог появиться после validate
        Errors errors = new Errors();
        PMDConfiguration config = config();
        config.setReporter(errors);
        try {
            RuleSet rs = RuleSetLoader.fromPmdConfig(config).loadFromString("pmd-ruleset.xml", xml);
            if (errors.first == null) return rs;
        } catch (RuntimeException e) { // RuleSetLoadException и ошибки разбора свойств правил
            if (errors.first == null) errors.first = String.valueOf(e.getMessage());
        }
        Matcher mt = LINE.matcher(errors.first);
        // PMD печатает фрагмент XML с «^^^^^ текст ошибки» — оставляем только текст
        String why = errors.first.replace("''", "'");
        int caret = why.lastIndexOf("^ ");
        if (caret >= 0) why = why.substring(caret + 2).lines().findFirst().orElse(why);
        throw new InvalidRulesetException("ruleset PMD не загружается: " + why.strip(), mt.find() ? Integer.valueOf(mt.group(1)) : null);
    }

    /** Первая ошибка загрузки ruleset (PMD пишет подробности в reporter, а исключение — общее). */
    private static final class Errors implements PmdReporter {
        String first;
        int count;

        @Override
        public boolean isLoggable(Level level) {
            return level == Level.ERROR;
        }

        @Override
        public void logEx(Level level, String message, Object[] args, Throwable error) {
            if (level != Level.ERROR) return;
            count++;
            if (first != null) return;
            String text = message == null ? "" : args == null || args.length == 0 ? message : MessageFormat.format(message, args);
            if (error != null && error.getMessage() != null && !text.contains(error.getMessage())) text += ": " + error.getMessage();
            first = text;
        }

        @Override
        public int numErrors() {
            return count;
        }
    }

    private static PMDConfiguration config() {
        PMDConfiguration config = new PMDConfiguration();
        config.setDefaultLanguageVersion(LanguageRegistry.PMD.getLanguageVersionById("java", "21"));
        config.setIgnoreIncrementalAnalysis(true);
        return config;
    }

    /** SAX-проход: битый XML и запрещённые ссылки/классы → исключение со строкой. */
    private static void checkXml(String xml) {
        try {
            SAXParserFactory f = SAXParserFactory.newInstance();
            f.setNamespaceAware(true);
            f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            // те же UTF-8 байты, что получит PMD; другая кодировка в прологе — парсеры прочли бы документ по-разному
            Matcher enc = ENCODING.matcher(xml);
            if (enc.find() && !enc.group(1).equalsIgnoreCase("UTF-8"))
                throw fail("кодировка ruleset только UTF-8, в прологе: " + enc.group(1), 1);
            f.newSAXParser().parse(new InputSource(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))), new DefaultHandler() {
                Locator loc;
                boolean root = true;
                int depthInProperty; // > 0 — внутри <property>
                StringBuilder nameText; // текст вложенного <name> внутри <property>

                @Override
                public void setDocumentLocator(Locator locator) {
                    loc = locator;
                }

                @Override
                public void startElement(String uri, String local, String qName, Attributes a) {
                    int line = loc == null ? 0 : loc.getLineNumber();
                    if (root && !local.equals("ruleset")) throw fail("корневой элемент должен быть <ruleset>", line);
                    root = false;
                    // атрибут с «xpath» в имени у любого элемента (напр. violationSuppressXPath="…" прямо на <rule>)
                    for (int i = 0; i < a.getLength(); i++) {
                        if (a.getLocalName(i).toLowerCase(java.util.Locale.ROOT).contains("xpath")
                                || a.getQName(i).toLowerCase(java.util.Locale.ROOT).contains("xpath"))
                            throw fail("атрибуты с XPath (" + a.getQName(i) + ") не поддерживаются — XPath может читать файлы и URL", line);
                    }
                    String ref = a.getValue("ref");
                    if (ref != null && (!REF.matcher(ref).matches() || ref.contains("..")))
                        throw fail("ссылка на правило только из набора PMD (category/…/*.xml[/Rule]): " + ref, line);
                    // PMD ищет ссылку сначала в файлах относительно рабочей папки, потом в classpath (ResourceLoader;
                    // загрузчик только из classpath в 7.28 не публичный) — подложенный файл с тем же путём не принимаем
                    if (ref != null && new java.io.File(ref.replaceFirst("(\\.xml)/[A-Za-z0-9_]+$", "$1")).exists())
                        throw fail("ссылка на правило совпадает с файлом на сервере, а не с набором PMD: " + ref, line);
                    // Свои правила (class=…, в т.ч. XPathRule) и подмена xpath у ссылок запрещены: XPath на Saxon читает файлы
                    // и URL (doc, unparsed-text, collection, json-doc, environment-variable…) — демо публичное, черный список функций ненадёжен.
                    String cls = a.getValue("class");
                    if (local.equals("rule") && cls != null)
                        throw fail("свои правила (class) не поддерживаются — только ссылки на правила PMD: " + cls, line);
                    // Любое свойство с «xpath» в имени исполняется Saxon: xpath, violationSuppressXPath и т.п.
                    if (depthInProperty > 0) depthInProperty++;
                    if (local.equals("property")) {
                        depthInProperty = 1;
                        checkProperty(a.getValue("name"), line);
                    } else if (depthInProperty > 0 && local.equals("name")) {
                        nameText = new StringBuilder();
                    }
                }

                @Override
                public void characters(char[] ch, int start, int length) {
                    if (nameText != null) nameText.append(ch, start, length);
                }

                @Override
                public void endElement(String uri, String local, String qName) {
                    if (nameText != null && local.equals("name")) {
                        checkProperty(nameText.toString(), loc == null ? 0 : loc.getLineNumber());
                        nameText = null;
                    }
                    if (depthInProperty > 0) depthInProperty--;
                }

                private void checkProperty(String name, int line) {
                    if (name != null && name.toLowerCase(java.util.Locale.ROOT).contains("xpath"))
                        throw fail("свойства с XPath (" + name.strip() + ") не поддерживаются — XPath может читать файлы и URL", line);
                }
            });
        } catch (InvalidRulesetException e) {
            throw e;
        } catch (SAXParseException e) {
            throw new InvalidRulesetException("XML не разбирается: " + e.getMessage(), e.getLineNumber() > 0 ? e.getLineNumber() : null);
        } catch (SAXException | IOException | javax.xml.parsers.ParserConfigurationException e) {
            throw new InvalidRulesetException("XML не разбирается: " + e.getMessage(), null);
        }
    }

    private static InvalidRulesetException fail(String message, int line) {
        return new InvalidRulesetException(message, line > 0 ? line : null);
    }

    private static boolean contains(Span s, int line) {
        return s.startLine() <= line && line <= s.endLine();
    }

    private static String resource(String name) {
        try (InputStream in = PmdDetector.class.getResourceAsStream(name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
