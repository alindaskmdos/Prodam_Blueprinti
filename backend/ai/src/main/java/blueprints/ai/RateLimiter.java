package blueprints.ai;

import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Лимиты запросов ИИ (§14а.10): не больше perMinute за скользящие 60 с на сессию и perDay на всех за сутки UTC.
 * Отказ — {@link Limited} с понятным сообщением и retryAfterSec. Запрос, упёршийся в лимит, не считается.
 */
public final class RateLimiter {
    public static final int DEFAULT_PER_MINUTE = 5;
    public static final int DEFAULT_PER_DAY = 200;
    private static final long MINUTE_MS = 60_000;
    private static final long DAY_MS = 86_400_000;

    /** Лимит исчерпан: в app — 429 RATE_LIMITED с details.retryAfterSec. */
    public static final class Limited extends RuntimeException {
        private final long retryAfterSec;

        Limited(String message, long retryAfterSec) {
            super(message);
            this.retryAfterSec = retryAfterSec;
        }

        public long retryAfterSec() {
            return retryAfterSec;
        }
    }

    private final int perMinute;
    private final int perDay;
    private final LongSupplier clockMs;
    private final Map<String, ArrayDeque<Long>> recent = new LinkedHashMap<>();
    private long day = Long.MIN_VALUE;
    private int usedToday;

    public RateLimiter(int perMinute, int perDay, LongSupplier clockMs) {
        this.perMinute = perMinute;
        this.perDay = perDay;
        this.clockMs = clockMs;
    }

    /** {@code LLM_RATE_PER_MINUTE}, {@code LLM_RATE_PER_DAY}; нет / не целое &gt; 0 — 5 и 200. */
    public static RateLimiter fromEnv(Map<String, String> env) {
        return new RateLimiter(positive(env.get("LLM_RATE_PER_MINUTE"), DEFAULT_PER_MINUTE),
                positive(env.get("LLM_RATE_PER_DAY"), DEFAULT_PER_DAY), System::currentTimeMillis);
    }

    public int perMinute() {
        return perMinute;
    }

    public int perDay() {
        return perDay;
    }

    /** Засчитывает запрос сессии или бросает {@link Limited}. */
    public synchronized void acquire(String session) {
        long now = clockMs.getAsLong();
        long today = Math.floorDiv(now, DAY_MS);
        if (today != day) {
            day = today;
            usedToday = 0;
        }
        // ponytail: проход по всем сессиям на каждый запрос — дешево при лимите в несколько запросов в минуту
        recent.values().removeIf(q -> {
            while (!q.isEmpty() && q.peekFirst() <= now - MINUTE_MS) q.pollFirst();
            return q.isEmpty();
        });
        ArrayDeque<Long> q = recent.computeIfAbsent(session, k -> new ArrayDeque<>());
        if (q.size() >= perMinute) {
            long sec = seconds(q.peekFirst() + MINUTE_MS - now);
            throw new Limited("Слишком много запросов к ИИ: не больше " + perMinute + " в минуту. Повторите через " + sec + " с", sec);
        }
        if (usedToday >= perDay) {
            long sec = seconds((today + 1) * DAY_MS - now);
            throw new Limited("Дневной лимит запросов к ИИ исчерпан (" + perDay + " в сутки). Повторите через "
                    + (sec + 59) / 60 + " мин", sec);
        }
        q.addLast(now);
        usedToday++;
    }

    private static long seconds(long ms) {
        return Math.max(1, (ms + 999) / 1000);
    }

    private static int positive(String s, int dflt) {
        try {
            int v = s == null ? dflt : Integer.parseInt(s.strip());
            return v > 0 ? v : dflt;
        } catch (NumberFormatException e) {
            return dflt;
        }
    }
}
