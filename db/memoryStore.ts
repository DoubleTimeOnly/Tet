import type { Store, TaskParams } from "./store";
import type { Deck, Task, Card, Note, Review, Completion } from "./schema";
import type { BackupData } from "../lib/backup";

/** In-memory Store: powers node tests and the web preview. */
export class MemoryStore implements Store {
  private decks: Deck[] = [];
  private tasks: Task[] = [];
  private notes: Note[] = [];
  private cards: Card[] = [];
  private reviews: Review[] = [];
  private completions: Completion[] = [];

  async init(): Promise<void> {}

  async insertDeck(deck: Deck): Promise<void> {
    this.decks.push({ ...deck });
  }
  async listDecks(): Promise<Deck[]> {
    return this.decks.map((d) => ({ ...d }));
  }

  async insertTask(task: Task): Promise<void> {
    this.tasks.push({ ...task });
  }
  async setTaskActive(id: string, active: boolean): Promise<void> {
    const t = this.tasks.find((x) => x.id === id);
    if (t) t.active = active;
  }
  async updateTaskParams(id: string, p: TaskParams): Promise<void> {
    const t = this.tasks.find((x) => x.id === id);
    if (t) {
      t.title = p.title;
      t.source_ref = p.source_ref;
      t.cadence = p.cadence;
      t.makes_cards_count = p.makes_cards_count;
      t.reading_target = p.reading_target;
    }
  }
  async updateTaskMeta(id: string, meta: string | null): Promise<void> {
    const t = this.tasks.find((x) => x.id === id);
    if (t) t.meta = meta;
  }
  async listTasks(opts: { activeOnly?: boolean } = {}): Promise<Task[]> {
    return this.tasks
      .filter((t) => (opts.activeOnly ? t.active : true))
      .map((t) => ({ ...t }));
  }
  async getTask(id: string): Promise<Task | null> {
    const t = this.tasks.find((x) => x.id === id);
    return t ? { ...t } : null;
  }

  async insertNote(note: Note): Promise<void> {
    this.notes.push({ ...note });
  }
  async getNote(id: string): Promise<Note | null> {
    const n = this.notes.find((x) => x.id === id);
    return n ? { ...n } : null;
  }
  async updateNoteFields(id: string, fields: string): Promise<void> {
    const n = this.notes.find((x) => x.id === id);
    if (n) n.fields = fields;
  }
  async listNotes(): Promise<Note[]> {
    return this.notes.map((n) => ({ ...n }));
  }

  async insertCard(card: Card): Promise<void> {
    this.cards.push({ ...card });
  }
  async updateCardScheduling(card: Card): Promise<void> {
    const c = this.cards.find((x) => x.id === card.id);
    if (c) {
      c.fsrs_state = card.fsrs_state;
      c.due = card.due;
      c.state_label = card.state_label;
    }
  }
  async updateCardContent(id: string, front: string, back: string): Promise<void> {
    const c = this.cards.find((x) => x.id === id);
    if (c) {
      c.front = front;
      c.back = back;
    }
  }
  async deleteCard(id: string): Promise<void> {
    this.cards = this.cards.filter((c) => c.id !== id);
  }
  async setCardIgnored(id: string, ignored: boolean): Promise<void> {
    const c = this.cards.find((x) => x.id === id);
    if (c) c.ignored = ignored;
  }
  async getCard(id: string): Promise<Card | null> {
    const c = this.cards.find((x) => x.id === id);
    return c ? { ...c } : null;
  }
  async listDueCards(nowMs: number, limit?: number): Promise<Card[]> {
    const due = this.cards
      .filter((c) => !c.ignored && c.due <= nowMs)
      .sort((a, b) => a.due - b.due)
      .map((c) => ({ ...c }));
    return limit === undefined ? due : due.slice(0, limit);
  }
  async listCardsByNote(noteId: string): Promise<Card[]> {
    return this.cards.filter((c) => c.note_id === noteId).map((c) => ({ ...c }));
  }
  async listAllCards(): Promise<Card[]> {
    return this.cards.map((c) => ({ ...c }));
  }
  async countCardsBySourceTask(taskId: string): Promise<number> {
    return this.cards.filter((c) => c.source_task_id === taskId).length;
  }

  async insertReview(review: Review): Promise<void> {
    this.reviews.push({ ...review });
  }
  async countReviews(): Promise<number> {
    return this.reviews.length;
  }
  async countReviewsSince(sinceMs: number): Promise<number> {
    return this.reviews.filter((r) => r.reviewed_at >= sinceMs).length;
  }
  async listReviewsSince(sinceMs: number): Promise<Review[]> {
    return this.reviews.filter((r) => r.reviewed_at >= sinceMs).map((r) => ({ ...r }));
  }

  async insertCompletion(completion: Completion): Promise<void> {
    this.completions.push({ ...completion });
  }
  async listCompletionsForDay(dayKey: string): Promise<Completion[]> {
    return this.completions
      .filter((c) => c.date === dayKey)
      .map((c) => ({ ...c }));
  }
  async listCompletions(): Promise<Completion[]> {
    return this.completions.map((c) => ({ ...c }));
  }

  async exportAll(): Promise<BackupData> {
    return {
      decks: this.decks.map((d) => ({ ...d })),
      tasks: this.tasks.map((t) => ({ ...t })),
      notes: this.notes.map((n) => ({ ...n })),
      cards: this.cards.map((c) => ({ ...c })),
      reviews: this.reviews.map((r) => ({ ...r })),
      completions: this.completions.map((c) => ({ ...c })),
    };
  }
  async replaceAll(data: BackupData): Promise<void> {
    this.decks = data.decks.map((d) => ({ ...d }));
    this.tasks = data.tasks.map((t) => ({ ...t }));
    this.notes = (data.notes ?? []).map((n) => ({ ...n }));
    this.cards = data.cards.map((c) => ({ ...c }));
    this.reviews = data.reviews.map((r) => ({ ...r }));
    this.completions = data.completions.map((c) => ({ ...c }));
  }
  async insertMany(decks: Deck[], cards: Card[], notes: Note[] = []): Promise<void> {
    this.decks.push(...decks.map((d) => ({ ...d })));
    this.notes.push(...notes.map((n) => ({ ...n })));
    this.cards.push(...cards.map((c) => ({ ...c })));
  }
}
