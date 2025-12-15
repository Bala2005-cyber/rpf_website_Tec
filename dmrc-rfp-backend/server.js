// server.js
console.log("🔥 server.js starting...");
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  console.log('Headers:', req.headers);
  next();
});

app.use(cors({ 
  origin: ["http://localhost:5173","http://127.0.0.1:5173","http://localhost:3000","http://127.0.0.1:3000"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ensure uploads dir exists
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); console.log("📁 uploads:", UPLOAD_DIR); }
app.use("/files", express.static(UPLOAD_DIR));

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/dmrc_rfp";
console.log("🔧 MONGO_URL =", MONGO_URL);

// Mongo
mongoose.connection.on("connected", () => console.log("✅ Mongo connected"));
mongoose.connection.on("error", (e) => console.error("❌ Mongo error:", e.message));
mongoose.set("strictQuery", true);
(async () => {
  try { await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 }); }
  catch (e) { console.error("❌ Initial connect failed:", e.message); }
})();

// Model
const Rfp = mongoose.model("Rfp", new mongoose.Schema({
  projectName: { type: String, required: true, trim: true },
  productSummary: { type: String, required: true, trim: true },
  deadline: { type: Date, required: true },
  durationDays: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["open","extended","closed"], default: "open" },
  fileName: String,
  fileUrl: String,
  mimeType: String,
  size: Number,
}, { timestamps: true }));

// Multer
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const base = path.parse(file.originalname).name.replace(/[^a-z0-9_-]/gi, "_");
    cb(null, `${base}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimetype);
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF, DOC, and DOCX files are allowed."), false);
    }
  }
});

// Routes
app.get("/health", (_, res) => {
  res.header('Content-Type', 'application/json');
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/test-json", (_, res) => {
  res.header('Content-Type', 'application/json');
  res.json({ message: "JSON test successful", timestamp: new Date().toISOString() });
});

app.delete("/test-delete/:id", (req, res) => {
  console.log(`Test DELETE received for ID: ${req.params.id}`);
  res.header('Content-Type', 'application/json');
  res.json({ message: "Test DELETE successful", id: req.params.id, timestamp: new Date().toISOString() });
});

app.put("/api/rfps/:id", async (req, res) => {
  console.log(`PUT request received for ID: ${req.params.id}`);
  res.header('Content-Type', 'application/json');
  
  try {
    const { projectName, productSummary, deadline, durationDays, status } = req.body;
    
    // Find and update the RFP
    const updatedRfp = await Rfp.findByIdAndUpdate(
      req.params.id,
      {
        projectName,
        productSummary,
        deadline: new Date(deadline),
        durationDays: parseInt(durationDays),
        status
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedRfp) {
      return res.status(404).json({ error: "RFP not found" });
    }
    
    console.log("RFP updated successfully:", updatedRfp);
    res.json({ message: "RFP updated successfully", rfp: updatedRfp });
  } catch (error) {
    console.error("Error updating RFP:", error);
    res.status(500).json({ error: "Failed to update RFP: " + error.message });
  }
});

app.delete("/api/rfps/:id", async (req, res) => {
  console.log(`DELETE request received for ID: ${req.params.id}`);
  console.log('Request headers:', req.headers);
  
  res.header('Content-Type', 'application/json');
  
  try {
    const rfp = await Rfp.findById(req.params.id);
    if (!rfp) {
      console.log('RFP not found');
      return res.status(404).json({ error: "RFP not found" });
    }

    console.log('Found RFP:', rfp);

    // Delete the associated file if it exists
    if (rfp.fileUrl) {
      const filePath = path.join(__dirname, "uploads", path.basename(rfp.fileUrl));
      console.log("Attempting to delete file:", filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("File deleted successfully");
      } else {
        console.log("File not found:", filePath);
      }
    }

    // Delete the RFP from database
    await Rfp.findByIdAndDelete(req.params.id);
    console.log("RFP deleted from database");
    res.json({ message: "RFP deleted successfully" });
  } catch (error) {
    console.error("Error deleting RFP:", error);
    res.status(500).json({ error: "Failed to delete RFP: " + error.message });
  }
});

app.post("/api/rfps", (req, res) => {
  const uploader = upload.single("file");
  uploader(req, res, async (err) => {
    console.log("Multer callback - err:", err);
    console.log("req.file:", req.file);
    console.log("req.body:", req.body);
    console.log("req.headers content-type:", req.headers['content-type']);
    
    if (err) {
      // A Multer error occurred when uploading.
      return res.status(400).json({ error: err.message });
    }

    // Everything went fine with multer, proceed with your logic.
    try {
      const { projectName, productSummary, deadline, durationDays, status } = req.body;
      if (!req.file) throw new Error("RFP document (file) is required");
      const d = new Date(deadline);
      const dur = Number(durationDays);
      const st = (status || "open").toLowerCase();
      if (!projectName?.trim() || !productSummary?.trim()) throw new Error("projectName and productSummary are required");
      if (Number.isNaN(d.valueOf())) throw new Error("deadline must be YYYY-MM-DD");
      if (!Number.isFinite(dur) || dur < 1) throw new Error("durationDays must be a positive number");
      if (!["open","extended","closed"].includes(st)) throw new Error("status must be open|extended|closed");

      const doc = await Rfp.create({
        projectName: projectName.trim(),
        productSummary: productSummary.trim(),
        deadline: d,
        durationDays: dur,
        status: st,
        fileName: req.file.originalname,
        fileUrl: `/files/${req.file.filename}`,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });
      res.status(201).json(doc);
    } catch (e) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: e.message });
    }
  });
});

// Helper function to update RFP status based on deadline
const updateRfpStatusBasedOnDeadline = async () => {
  try {
    const now = new Date();
    const expiredRfps = await Rfp.find({
      deadline: { $lt: now },
      status: { $ne: 'closed' }
    });
    
    for (const rfp of expiredRfps) {
      await Rfp.findByIdAndUpdate(rfp._id, { status: 'closed' });
      console.log(`Updated RFP ${rfp._id} to 'closed' status due to expired deadline`);
    }
  } catch (error) {
    console.error('Error updating RFP statuses:', error);
  }
};

// Check for expired RFPs every 5 minutes
setInterval(updateRfpStatusBasedOnDeadline, 5 * 60 * 1000);

// Run once on startup
updateRfpStatusBasedOnDeadline();

app.get("/api/rfps", async (req, res) => {
  const { tab = "recent", sort = "uploadedAt" } = req.query;
  const now = new Date();
  const q = {};
  if (tab === "completed") q.$or = [{ status: "closed" }, { deadline: { $lt: now } }];
  if (tab === "extended") q.status = "extended";
  const sortMap = { uploadedAt: { createdAt: -1 }, deadline: { deadline: 1 } };
  const items = await Rfp.find(q).sort(sortMap[sort] || sortMap.uploadedAt);
  res.json(items);
});

app.get("/api/rfps/:id", async (req, res) => {
  const item = await Rfp.findById(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

// Add error handling middleware to ensure JSON responses
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  console.log('404 for path:', req.method, req.path);
  res.header('Content-Type', 'application/json');
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Start
const server = app.listen(PORT, () => console.log(`🚀 API listening on http://localhost:${PORT}`));
process.on("SIGINT", ()=>{ server.close(()=>mongoose.connection.close(false, ()=>process.exit(0))); });
