const express = require("express");
const Kernel = require("./core/kernel");
const ELOHIM = require("./runtime/elohim");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const kernel = new Kernel();
new ELOHIM(kernel);

// HEALTH
app.get("/api/health", (req, res) => {
  res.json({
    system: "OMNIVEX-ORGANISM",
    status: "ONLINE",
    state: kernel.state,
    agents: Object.keys(kernel.agents)
  });
});

// TICK (CRITICAL FIX)
app.post("/api/tick", async (req, res) => {
  try {
    const state = await kernel.tick();
    res.json(state);
  } catch (e) {
    res.status(500).json({
      error: "TICK_FAILED",
      message: e.message
    });
  }
});

// REPLAY
app.get("/api/replay", (req, res) => {
  res.json(kernel.replay(20));
});

app.listen(PORT, () => {
  console.log(`OMNIVEX ORGANI SM ONLINE ON PORT ${PORT}`);
  console.log(`HEALTH: http://localhost:${PORT}/api/health`);
  console.log(`TICK: http://localhost:${PORT}/api/tick`);
});


// MEMORY LEARNING ENDPOINT
app.get("/api/memory/stats", (req, res) => {
  res.json(kernel.memory.stats());
});

app.get("/api/memory/training", (req, res) => {
  res.json(kernel.memory.getTrainingBatch(50));
});
