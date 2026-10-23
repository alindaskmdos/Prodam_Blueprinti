package com.demo.model;

/** Customer loyalty tier with a percent discount. */
public enum Tier {
    STANDARD(0, "std"),
    SILVER(5, "slv"),
    GOLD(10, "gld") {
        @Override
        public String badge() {
            return "*" + code() + "*";
        }
    };

    private final int discountPercent;
    private final String code;

    Tier(int discountPercent, String code) {
        this.discountPercent = discountPercent;
        this.code = code;
    }

    public int discountPercent() {
        return discountPercent;
    }

    public String code() {
        return code;
    }

    public String badge() {
        return "[" + code + "]";
    }

    public static Tier parse(String s) {
        switch (s.toLowerCase()) {
            case "gold":
                return GOLD;
            case "silver":
                return SILVER;
            default:
                return STANDARD;
        }
    }
}
