package com.demo.service;

import com.demo.model.Customer;
import com.demo.model.Product;
import com.demo.model.Tier;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** In-memory store of customers and products. */
public class Catalog {
    private final List<Customer> customers = new ArrayList<>();
    private final List<Product> products = new ArrayList<>();

    public void addCustomer(int id, String name, String tier) {
        if (findCustomer(id).isPresent()) {
            throw new IllegalStateException("duplicate customer " + id);
        }
        customers.add(new Customer(id, name, Tier.parse(tier)));
    }

    public void addProduct(int id, String name, long priceCents, int stock) {
        for (Product p : products) {
            if (p.getId() == id) {
                throw new IllegalStateException("duplicate product " + id);
            }
        }
        products.add(new Product(id, name, priceCents, stock));
    }

    public Optional<Customer> findCustomer(int id) {
        for (Customer c : customers) {
            if (c.id() == id) {
                return Optional.of(c);
            }
        }
        return Optional.empty();
    }

    public Optional<Product> findProduct(int id) {
        for (int i = 0; i < products.size(); i++) {
            Product p = products.get(i);
            if (p.getId() == id) {
                return Optional.of(p);
            }
        }
        return Optional.empty();
    }

    public List<Customer> customers() {
        return customers;
    }

    public List<Product> products() {
        return products;
    }

    public int customerCount() {
        return customers.size();
    }

    public int productCount() {
        return products.size();
    }
}
