package blueprints.testing.io;

import blueprints.runner.Runner;

/**
 * Наблюдаемое поведение одного запуска — то, что сравнивается по §10.3.
 *
 * @param stdout    вывод, сравнивается побайтово
 * @param exitCode  код выхода; null — не проверяется (manual-тест задаёт только stdout)
 * @param exception «тип: сообщение» необработанного исключения из stderr без строк stack trace;
 *                  null — исключения не было (или не проверяется, если exitCode тоже null)
 * @param truncated вывод был обрезан раннером (больше 1 МБ) — сравнивать нельзя
 */
public record Observed(String stdout, Integer exitCode, String exception, boolean truncated) {

    public Observed(String stdout, Integer exitCode, String exception) {
        this(stdout, exitCode, exception, false);
    }

    private static final String UNCAUGHT = "Exception in thread \"";

    /** Поведение запуска; stderr целиком не сравнивается — из него берётся только необработанное исключение. */
    public static Observed of(Runner.RunResult r) {
        return new Observed(r.stdout(), r.exitCode(), uncaughtException(r.stderr()), r.truncated());
    }

    /** Ожидание, заданное пользователем: только stdout. */
    public static Observed stdoutOnly(String stdout) {
        return new Observed(stdout, null, null);
    }

    /**
     * Первое необработанное исключение из stderr JVM: строка после {@code Exception in thread "..."} и
     * продолжение многострочного сообщения; строки {@code \tat ...}, {@code ... N more}, {@code Caused by:} отбрасываются.
     */
    public static String uncaughtException(String stderr) {
        if (stderr == null) return null;
        String[] lines = stderr.split("\r?\n", -1);
        for (int i = 0; i < lines.length; i++) {
            int at = lines[i].indexOf(UNCAUGHT);
            if (at < 0) continue;
            int close = lines[i].indexOf("\" ", at + UNCAUGHT.length());
            if (close < 0) continue;
            StringBuilder sb = new StringBuilder(lines[i].substring(close + 2));
            for (int j = i + 1; j < lines.length && !isTraceLine(lines[j]); j++) {
                sb.append('\n').append(lines[j]);
            }
            return sb.toString().stripTrailing();
        }
        return null;
    }

    private static boolean isTraceLine(String line) {
        String s = line.stripLeading();
        return s.startsWith("at ") || s.startsWith("Caused by:") || s.startsWith("Suppressed:")
                || (s.startsWith("... ") && s.endsWith(" more")) || line.isEmpty();
    }
}
