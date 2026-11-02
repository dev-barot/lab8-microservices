const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const Order = require('./Order');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3003;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/order_db';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002';

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to Order Database'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Health Check Endpoint (for Kubernetes Liveness and Readiness Probes)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'Order Service',
    timestamp: new Date().toISOString()
  });
});

// 1. GET all orders
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find();
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. GET order by ID
app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. POST new order (WITH SERVICE-TO-SERVICE VALIDATION)
app.post('/orders', async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;

    // A. Validate User via User Service
    try {
      await axios.get(`${USER_SERVICE_URL}/users/${userId}`);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ message: 'Invalid User ID' });
      }
      // If service is down or connection refused (Requirement #10)
      return res.status(503).json({ message: 'User Service is currently unavailable. Please try again later.' });
    }

    // B. Validate Product via Product Service
    try {
      await axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ message: 'Invalid Product ID' });
      }
      // If service is down or connection refused (Requirement #10)
      return res.status(503).json({ message: 'Product Service is currently unavailable. Please try again later.' });
    }

    // C. If both are valid, save the order to our Order DB
    const newOrder = new Order(req.body);
    await newOrder.save();
    res.status(201).json(newOrder);

  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Order Service running on port ${PORT}`);
});
