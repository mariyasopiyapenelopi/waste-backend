const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const mqtt = require('mqtt');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✅ Connected to PostgreSQL!');
  }
});

// MQTT Connection
const mqttClient = mqtt.connect(process.env.MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT Broker!');
  mqttClient.subscribe('waste/compartment/+/weight');
  mqttClient.subscribe('waste/compartment/+/status');
});

mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const topicParts = topic.split('/');
    const compartment = topicParts[2];
    const messageType = topicParts[3];

    if (messageType === 'weight') {
      // Save weight reading to database
      await pool.query(
        `INSERT INTO waste_readings 
        (compartment, waste_type, sub_type, weight_kg) 
        VALUES ($1, $2, $3, $4)`,
        [compartment, data.waste_type, data.sub_type, data.weight_kg]
      );
      console.log(`📦 Weight data saved for Compartment ${compartment}`);
    }

    if (messageType === 'status') {
      // Update compartment status
      await pool.query(
        `UPDATE compartment_status 
        SET is_active = $1, last_updated = NOW() 
        WHERE compartment = $2`,
        [data.is_active, compartment]
      );
      console.log(`🔄 Status updated for Compartment ${compartment}`);
    }
  } catch (err) {
    console.error('MQTT message error:', err);
  }
});

// ─────────────────────────────────────────
// API ENDPOINTS
// ─────────────────────────────────────────

// GET /api/dashboard — Main dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    // Total recyclable waste
    const totalRecyclable = await pool.query(
      `SELECT COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings 
      WHERE waste_type = 'recyclable'`
    );

    // Waste by sub_type
    const bySubType = await pool.query(
      `SELECT sub_type, COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings 
      WHERE waste_type = 'recyclable' 
      GROUP BY sub_type`
    );

    // Total all waste
    const totalAll = await pool.query(
      `SELECT COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings`
    );

    // Compartment status
    const compartments = await pool.query(
      `SELECT * FROM compartment_status ORDER BY compartment`
    );

    // Format sub_type data
    const subTypes = { paper: 0, plastic: 0, glass: 0, metal: 0 };
    bySubType.rows.forEach(row => {
      if (subTypes.hasOwnProperty(row.sub_type)) {
        subTypes[row.sub_type] = parseFloat(row.total);
      }
    });

    res.json({
      total_waste_kg: parseFloat(totalAll.rows[0].total),
      recyclable_total_kg: parseFloat(totalRecyclable.rows[0].total),
      paper_kg: subTypes.paper,
      plastic_kg: subTypes.plastic,
      glass_kg: subTypes.glass,
      metal_kg: subTypes.metal,
      compartments: compartments.rows,
    });
  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/analytics — Analytics with date filtering
app.get('/api/analytics', async (req, res) => {
  try {
    const { from, to, type } = req.query;
    const wasteType = type || 'recyclable';

    let dateFilter = '';
    const params = [wasteType];

    if (from && to) {
      dateFilter = `AND recorded_at BETWEEN $2 AND $3`;
      params.push(from, to);
    }

    // Today
    const today = await pool.query(
      `SELECT COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings 
      WHERE waste_type = $1 
      AND DATE(recorded_at) = CURRENT_DATE`,
      [wasteType]
    );

    // This week
    const thisWeek = await pool.query(
      `SELECT COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings 
      WHERE waste_type = $1 
      AND recorded_at >= DATE_TRUNC('week', NOW())`,
      [wasteType]
    );

    // This month
    const thisMonth = await pool.query(
      `SELECT COALESCE(SUM(weight_kg), 0) as total 
      FROM waste_readings 
      WHERE waste_type = $1 
      AND recorded_at >= DATE_TRUNC('month', NOW())`,
      [wasteType]
    );

    // Most collected sub_type
    const mostCollected = await pool.query(
      `SELECT sub_type, SUM(weight_kg) as total 
      FROM waste_readings 
      WHERE waste_type = $1 
      AND sub_type IS NOT NULL 
      GROUP BY sub_type 
      ORDER BY total DESC 
      LIMIT 1`,
      [wasteType]
    );

    // Chart data (daily totals)
    const chartData = await pool.query(
      `SELECT DATE(recorded_at) as date, 
      SUM(weight_kg) as total 
      FROM waste_readings 
      WHERE waste_type = $1 ${dateFilter}
      GROUP BY DATE(recorded_at) 
      ORDER BY date ASC`,
      params
    );

    res.json({
      today_kg: parseFloat(today.rows[0].total),
      week_kg: parseFloat(thisWeek.rows[0].total),
      month_kg: parseFloat(thisMonth.rows[0].total),
      most_collected: mostCollected.rows[0]?.sub_type || '--',
      chart_data: chartData.rows,
    });
  } catch (err) {
    console.error('Analytics API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/compartments — Compartment status
app.get('/api/compartments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM compartment_status ORDER BY compartment`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Compartments API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/test-data — Insert dummy data for testing
app.post('/api/test-data', async (req, res) => {
  try {
    const testReadings = [
      { compartment: 'A', waste_type: 'recyclable', sub_type: 'plastic', weight_kg: 1.25 },
      { compartment: 'A', waste_type: 'recyclable', sub_type: 'paper', weight_kg: 0.75 },
      { compartment: 'A', waste_type: 'recyclable', sub_type: 'glass', weight_kg: 0.50 },
      { compartment: 'A', waste_type: 'recyclable', sub_type: 'metal', weight_kg: 0.30 },
    ];

    for (const reading of testReadings) {
      await pool.query(
        `INSERT INTO waste_readings 
        (compartment, waste_type, sub_type, weight_kg) 
        VALUES ($1, $2, $3, $4)`,
        [reading.compartment, reading.waste_type, reading.sub_type, reading.weight_kg]
      );
    }

    await pool.query(
      `UPDATE compartment_status SET is_active = true, last_updated = NOW() WHERE compartment = 'A'`
    );

    res.json({ message: '✅ Test data inserted successfully!' });
  } catch (err) {
    console.error('Test data error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend server running on port ${PORT}`);
}); 
