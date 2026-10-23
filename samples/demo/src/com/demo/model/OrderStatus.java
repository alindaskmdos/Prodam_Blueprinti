package com.demo.model;

public enum OrderStatus {
    NEW, RESERVED, SHIPPED, REJECTED, MERGED;

    public boolean isFinal() {
        return this == SHIPPED || this == REJECTED || this == MERGED;
    }

    public boolean canMerge() {
        return this == NEW;
    }
}
