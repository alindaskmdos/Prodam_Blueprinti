package com.demo.model;

public record OrderLine(int productId, int qty) {
    public OrderLine withQty(int newQty) {
        return new OrderLine(productId, newQty);
    }

    public OrderLine plus(OrderLine other) {
        return new OrderLine(productId, qty + other.qty);
    }
}
