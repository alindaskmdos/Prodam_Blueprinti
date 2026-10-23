package blueprints.testing.junit;

import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Разбор XML-отчёта console launcher'а ({@code --reports-dir}, формат legacy JUnit XML: {@code testsuite/testcase})
 * в общий {@link TestResult}: имя {@code полное.имя.Класса.метод} (пакет по умолчанию — {@code Класс.метод}), {@code <failure>}/{@code <error>} → {@code failed} с сообщением
 * без stack trace, {@code <skipped>} → {@code passed} с пояснением «пропущен», иначе {@code passed}.
 */
public final class JUnitReport {
    public static final String SKIPPED = "пропущен";
    static final int MAX_ERROR = 1000;

    private JUnitReport() {
    }

    /** @throws IllegalArgumentException если это не XML-отчёт */
    public static List<TestResult> parse(String xml) {
        Element root;
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            f.setExpandEntityReferences(false);
            root = f.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)))
                    .getDocumentElement();
        } catch (Exception e) {
            throw new IllegalArgumentException("Не XML-отчёт JUnit: " + e.getMessage(), e);
        }
        if (!root.getTagName().equals("testsuite") && !root.getTagName().equals("testsuites")) {
            throw new IllegalArgumentException("Не XML-отчёт JUnit: корень <" + root.getTagName() + ">");
        }
        List<TestResult> res = new ArrayList<>();
        NodeList cases = root.getElementsByTagName("testcase");
        for (int i = 0; i < cases.getLength(); i++) res.add(toResult((Element) cases.item(i)));
        return res;
    }

    private static TestResult toResult(Element tc) {
        String name = tc.getAttribute("classname") + "." + method(tc.getAttribute("name"));
        long ms = millis(tc.getAttribute("time"));
        Element failure = child(tc, "failure");
        Element error = child(tc, "error");
        Element skipped = child(tc, "skipped");
        TestStatus status = TestStatus.PASSED;
        String text = null;
        if (failure != null) {
            status = TestStatus.FAILED;
            text = message(failure, false);
        } else if (error != null) {
            status = TestStatus.FAILED;
            text = message(error, true);
        } else if (skipped != null) {
            String why = skipped.getAttribute("message");
            if (why.isBlank()) why = firstLine(skipped.getTextContent());
            text = why.isBlank() ? SKIPPED : SKIPPED + ": " + why;
        }
        return new TestResult(name, JUnitTestSource.TYPE, status, ms, cut(text), null, null, List.of());
    }

    /** Сообщение ассерта; для исключения — «Тип: сообщение». Stack trace не берётся. */
    private static String message(Element e, boolean withType) {
        String type = e.getAttribute("type");
        String msg = e.getAttribute("message");
        if (!e.hasAttribute("message")) {
            // нет атрибута — первая строка тела («тип: сообщение» из stack trace)
            String first = firstLine(e.getTextContent());
            if (!first.isBlank()) return first;
        }
        if (msg.isBlank()) return type.isBlank() ? "тест не прошёл" : simpleClass(type);
        return withType && !type.isBlank() ? simpleClass(type) + ": " + msg : msg;
    }

    private static Element child(Element parent, String tag) {
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element el && el.getTagName().equals(tag)) return el;
        }
        return null;
    }

    static String simpleClass(String fqn) {
        return fqn.substring(fqn.lastIndexOf('.') + 1);
    }

    /** {@code add()} → {@code add}; параметризованные ({@code add(int)[1]}) — как есть. */
    private static String method(String name) {
        return name.endsWith("()") ? name.substring(0, name.length() - 2) : name;
    }

    private static long millis(String time) {
        try {
            return Math.round(Double.parseDouble(time.replace(",", "")) * 1000);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        String t = s.strip();
        int nl = t.indexOf('\n');
        return (nl < 0 ? t : t.substring(0, nl)).strip();
    }

    static String cut(String s) {
        if (s == null || s.length() <= MAX_ERROR) return s;
        return s.substring(0, MAX_ERROR) + "…";
    }
}
