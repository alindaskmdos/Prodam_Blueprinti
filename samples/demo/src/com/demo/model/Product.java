package com.demo.model;

public class Product {
    private final int id;
    private final String name;
    private final long priceCents;
    private int stock;

    public Product(int id, String name, long priceCents, int stock) {
        this.id = id;
        this.name = name;
        this.priceCents = priceCents;
        this.stock = stock;
    }

    public int getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public long getPriceCents() {
        return priceCents;
    }

    public int getStock() {
        return stock;
    }

    public boolean take(int qty) {
        if (qty <= 0 || qty > stock) {
            return false;
        }
        stock -= qty;
        return true;
    }

    public void give(int qty) {
        stock += qty;
    }

    @Override
    public String toString() {
        return "Product#" + id + "(" + name + ", stock=" + stock + ")";
    }
}
