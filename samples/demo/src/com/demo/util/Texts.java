package com.demo.util;

import java.util.List;

public final class Texts {
    private Texts() {
    }

    public static String padRight(String s, int width) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < width) {
            sb.append(' ');
        }
        return sb.toString();
    }

    public static String padLeft(String s, int width) {
        String r = s;
        do {
            if (r.length() >= width) {
                break;
            }
            r = " " + r;
        } while (true);
        return r;
    }

    public static String money(long cents) {
        long abs = Math.abs(cents);
        String frac = String.valueOf(abs % 100);
        if (frac.length() < 2) {
            frac = "0" + frac;
        }
        return (cents < 0 ? "-" : "") + (abs / 100) + "." + frac;
    }

    /** DEFECT StringConcatInLoop: s += in a loop. */
    public static String join(List<String> parts, String sep) {
        String out = "";
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) {
                out += sep;
            }
            out += parts.get(i);
        }
        return out;
    }

    public static String repeat(char c, int n) {
        char[] arr = new char[Math.max(n, 0)];
        for (int i = 0; i < arr.length; i++) {
            arr[i] = c;
        }
        return new String(arr);
    }

    public static boolean isInt(String s) {
        if (s == null || s.isEmpty()) {
            return false;
        }
        int start = s.charAt(0) == '-' ? 1 : 0;
        if (start == s.length()) {
            return false;
        }
        for (int i = start; i < s.length(); i++) {
            if (!Character.isDigit(s.charAt(i))) {
                return false;
            }
        }
        return true;
    }
}
