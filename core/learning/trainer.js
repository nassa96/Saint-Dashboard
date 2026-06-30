class Trainer {
  constructor(genome, memory, allocator) {
    this.genome = genome;
    this.memory = memory;
    this.allocator = allocator;
  }

  evolve() {
    const batch = this.memory.getTrainingBatch(100);

    let score = 0;

    for (const r of batch) {
      score += r.label;
    }

    const fitness = score / Math.max(1, batch.length);

    const selected = this.genome.select();

    // genome evolution
    this.genome.mutateFitness(selected.id, fitness);

    // capital evolution (NEW CORE IDEA)
    const pnl = batch.reduce((a, b) => a + (b.pnl || 0), 0);

    this.allocator.update(selected.id, pnl);

    this.genome.updateEquity(selected.id, pnl);

    return {
      fitness,
      pnl,
      mutated: selected.id,
      allocations: this.allocator.snapshot()
    };
  }
}

module.exports = Trainer;
