package com.demo.util;

import java.util.ArrayList;
import java.util.List;

/** One parsed input line: a verb and its whitespace separated arguments. */
public class CommandLine {
    private final String verb;
    private final List<String> args;

    private CommandLine(String verb, List<String> args) {
        this.verb = verb;
        this.args = args;
    }

    public static CommandLine parse(String raw) {
        String line = raw.trim();
        if (line.isEmpty() || line.startsWith("#")) {
            return null;
        }
        List<String> parts = new ArrayList<>();
        int i = 0;
        while (i < line.length()) {
            while (i < line.length() && line.charAt(i) == ' ') {
                i++;
            }
            int start = i;
            while (i < line.length() && line.charAt(i) != ' ') {
                i++;
            }
            if (i > start) {
                parts.add(line.substring(start, i));
            }
        }
        String verb = parts.remove(0).toUpperCase(java.util.Locale.ROOT);
        return new CommandLine(verb, parts);
    }

    public String verb() {
        return verb;
    }

    public int size() {
        return args.size();
    }

    public String arg(int i) {
        return args.get(i);
    }

    public int intArg(int i) {
        String s = args.get(i);
        if (!Texts.isInt(s)) {
            throw new NumberFormatException("not a number: " + s);
        }
        return Integer.parseInt(s);
    }

    public String rest(int from) {
        return Texts.join(args.subList(from, args.size()), " ");
    }
}
