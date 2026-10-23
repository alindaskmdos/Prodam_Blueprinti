package com.demo.model;

public record Customer(int id, String name, Tier tier) {
    public Customer {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("empty customer name");
        }
    }

    public String label() {
        return name + " " + tier.badge();
    }
}
