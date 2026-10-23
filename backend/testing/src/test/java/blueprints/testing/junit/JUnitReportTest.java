package blueprints.testing.junit;

import static org.junit.jupiter.api.Assertions.*;

import blueprints.testing.TestResult;
import blueprints.testing.TestStatus;
import java.util.List;
import org.junit.jupiter.api.Test;

class JUnitReportTest {

    private static final String XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <testsuite name="JUnit Jupiter" tests="5" skipped="1" failures="2" errors="1" time="0.3">
              <properties><property name="java.version" value="21"/></properties>
              <testcase name="adds()" classname="com.demo.CalcTest" time="0.012"/>
              <testcase name="wrong()" classname="com.demo.CalcTest" time="0.004">
                <failure message="expected: &lt;5&gt; but was: &lt;4&gt;" type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError: expected: &lt;5&gt; but was: &lt;4&gt;
            \tat org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)
            \tat com.demo.CalcTest.wrong(CalcTest.java:12)</failure>
              </testcase>
              <testcase name="boom()" classname="com.demo.CalcTest" time="1,234.5">
                <error message="Index 3 out of bounds for length 2" type="java.lang.ArrayIndexOutOfBoundsException">java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 2
            \tat com.demo.Calc.get(Calc.java:5)</error>
              </testcase>
              <testcase name="noMessage()" classname="Plain" time="0">
                <failure type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError
            \tat Plain.noMessage(Plain.java:3)</failure>
              </testcase>
              <testcase name="later()" classname="com.demo.CalcTest$Inner" time="0">
                <skipped message="не сейчас"/>
              </testcase>
              <testcase name="sum(int)[1]" classname="Plain" time="0.001"/>
              <system-out>unique-id: [engine:junit-jupiter]</system-out>
            </testsuite>
            """;

    @Test
    void mapsStatusesNamesAndMessages() {
        List<TestResult> rs = JUnitReport.parse(XML);
        assertEquals(List.of("com.demo.CalcTest.adds", "com.demo.CalcTest.wrong", "com.demo.CalcTest.boom", "Plain.noMessage",
                "com.demo.CalcTest$Inner.later", "Plain.sum(int)[1]"), rs.stream().map(TestResult::name).toList());
        assertEquals(List.of(TestStatus.PASSED, TestStatus.FAILED, TestStatus.FAILED, TestStatus.FAILED,
                TestStatus.PASSED, TestStatus.PASSED), rs.stream().map(TestResult::status).toList());
        assertTrue(rs.stream().allMatch(r -> r.type().equals("junit")));
        assertNull(rs.get(0).error());
        assertEquals(12, rs.get(0).durationMs());
        assertEquals("expected: <5> but was: <4>", rs.get(1).error(), "сообщение ассерта без stack trace");
        assertEquals("ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 2", rs.get(2).error());
        assertEquals(1_234_500, rs.get(2).durationMs());
        assertEquals("org.opentest4j.AssertionFailedError", rs.get(3).error());
        assertEquals("пропущен: не сейчас", rs.get(4).error());
        assertFalse(rs.stream().anyMatch(r -> r.error() != null && r.error().contains("\tat ")));
    }

    /** Одноимённые классы из разных пакетов не сливаются. */
    @Test
    void sameSimpleNameInDifferentPackagesStaysDistinct() {
        var rs = JUnitReport.parse("<testsuite><testcase name=\"t()\" classname=\"a.XTest\" time=\"0\"/>"
                + "<testcase name=\"t()\" classname=\"b.XTest\" time=\"0\"/></testsuite>");
        assertEquals(List.of("a.XTest.t", "b.XTest.t"), rs.stream().map(TestResult::name).toList());
    }

    @Test
    void longMessageIsCut() {
        String msg = "x".repeat(5000);
        var rs = JUnitReport.parse("<testsuite><testcase name=\"a()\" classname=\"A\" time=\"0\">"
                + "<failure message=\"" + msg + "\" type=\"java.lang.AssertionError\"/></testcase></testsuite>");
        assertEquals(JUnitReport.MAX_ERROR + 1, rs.get(0).error().length());
    }

    @Test
    void emptySuiteHasNoResults() {
        assertEquals(List.of(), JUnitReport.parse("<testsuite name=\"JUnit Jupiter\" tests=\"0\"/>"));
    }

    @Test
    void rejectsNonReportAndDoctype() {
        assertThrows(IllegalArgumentException.class, () -> JUnitReport.parse(""));
        assertThrows(IllegalArgumentException.class, () -> JUnitReport.parse("Hello, world"));
        assertThrows(IllegalArgumentException.class, () -> JUnitReport.parse("<html/>"));
        assertThrows(IllegalArgumentException.class, () -> JUnitReport.parse(
                "<!DOCTYPE t [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><testsuite><testcase name=\"&x;\" classname=\"A\"/></testsuite>"));
    }
}
