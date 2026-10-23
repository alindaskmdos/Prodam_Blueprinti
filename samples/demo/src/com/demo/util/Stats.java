package com.demo.util;

import java.util.Collection;
import java.util.function.ToLongFunction;

public final class Stats {
    private Stats() {
    }

    public static <T> long sum(Collection<T> items, ToLongFunction<T> f) {
        long total = 0;
        for (T t : items) {
            total += f.applyAsLong(t);
        }
        return total;
    }

    public static <T> long max(Collection<T> items, ToLongFunction<T> f) {
        long best = Long.MIN_VALUE;
        for (T t : items) {
            long v = f.applyAsLong(t);
            if (v > best) {
                best = v;
            }
        }
        return items.isEmpty() ? 0 : best;
    }

    public static <T> double average(Collection<T> items, ToLongFunction<T> f) {
        if (items.isEmpty()) {
            return 0.0;
        }
        return (double) sum(items, f) / items.size();
    }

    public static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
