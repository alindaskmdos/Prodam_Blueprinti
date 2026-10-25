package blueprints.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class RateLimiterTest {
    @Test
    void perMinutePerSessionThenWindowSlides() {
        AtomicLong now = new AtomicLong(1_000_000);
        RateLimiter l = new RateLimiter(2, 100, now::get);
        l.acquire("a");
        now.addAndGet(20_000);
        l.acquire("a");
        l.acquire("b"); // другая сессия — свой счётчик
        var e = assertThrows(RateLimiter.Limited.class, () -> l.acquire("a"));
        assertEquals(40, e.retryAfterSec());
        assertEquals("Слишком много запросов к ИИ: не больше 2 в минуту. Повторите через 40 с", e.getMessage());
        now.addAndGet(40_000);
        l.acquire("a"); // первый запрос вышел из окна
    }

    @Test
    void dailyLimitIsSharedAndResetsAtUtcMidnight() {
        long day = 86_400_000L;
        AtomicLong now = new AtomicLong(10 * day + day - 120_000); // за 2 мин до полуночи
        RateLimiter l = new RateLimiter(5, 2, now::get);
        l.acquire("a");
        l.acquire("b");
        var e = assertThrows(RateLimiter.Limited.class, () -> l.acquire("c"));
        assertEquals(120, e.retryAfterSec());
        assertTrue(e.getMessage().startsWith("Дневной лимит запросов к ИИ исчерпан (2 в сутки)"), e.getMessage());
        now.addAndGet(120_000);
        l.acquire("c");
    }

    @Test
    void envOverridesWithFallback() {
        RateLimiter l = RateLimiter.fromEnv(Map.of("LLM_RATE_PER_MINUTE", "7", "LLM_RATE_PER_DAY", "x"));
        assertEquals(7, l.perMinute());
        assertEquals(RateLimiter.DEFAULT_PER_DAY, l.perDay());
        assertEquals(RateLimiter.DEFAULT_PER_MINUTE, RateLimiter.fromEnv(Map.of()).perMinute());
    }
}
