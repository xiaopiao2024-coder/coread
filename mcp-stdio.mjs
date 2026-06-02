#!/usr/bin/env node
import { createRequire } from 'module';
import path from 'path';
import { initDb, getDb, getImageDir } from './lib/db.mjs';
import { parseEpub, extractImages, extractCover, smartSplit } from './lib/epub.mjs';
import fs from 'fs';

const DB_PATH = process.env.COREAD_DB || path.join(process.cwd(), 'data', 'coread.db');
initDb(DB_PATH);

const CHAPTER_RE = /^第[\d一二三四五六七八九十百千万]+[章节回]|^#|^Chapter\s+\d/i;

const tools = [
  {
    name: 'list_books',
    description: 'List all books in the co-reading library',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_book',
    description: 'Read a section of a book by page number',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        page: { type: 'number', description: 'Page number (default 1)' },
        per_page: { type: 'number', description: 'Paragraphs per page (default 10)' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment/annotation to a paragraph in a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        paragraph_idx: { type: 'number', description: 'Paragraph index to comment on' },
        content: { type: 'string', description: 'Comment text' },
        from_who: { type: 'string', description: 'Who is commenting (default: "ai")' },
        selected_text: { type: 'string', description: 'Optional: highlighted text from the paragraph' },
        reply_to: { type: 'number', description: 'Optional: comment ID to reply to' },
      },
      required: ['book_id', 'paragraph_idx', 'content'],
    },
  },
  {
    name: 'list_comments',
    description: 'List all comments for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'get_toc',
    description: 'Get the table of contents for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'import_book',
    description: 'Import a book from text content or epub (base64)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Book title' },
        content: { type: 'string', description: 'Plain text content (for text import)' },
        format: { type: 'string', description: '"epub" for epub import' },
        data: { type: 'string', description: 'Base64-encoded epub file data' },
      },
      required: ['title'],
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment by ID',
    inputSchema: {
      type: 'object',
      properties: { comment_id: { type: 'number', description: 'Comment ID to delete' } },
      required: ['comment_id'],
    },
  },
  {
    name: 'update_progress',
    description: 'Update reading progress for a book',
    inputSchema: {
      type: 'object',
      properties: {
        book_id: { type: 'number', description: 'Book ID' },
        page: { type: 'number', description: 'Current page number' },
      },
      required: ['book_id', 'page'],
    },
  },
];

function handleTool(name, args) {
  switch (name) {
    case 'list_books': {
      const db = getDb(true);
      const books = db.prepare('SELECT b.id, b.title, b.total_paragraphs, b.created_at, b.cover_image, p.page as current_page FROM books b LEFT JOIN book_progress p ON b.id = p.book_id ORDER BY b.created_at DESC').all();
      const counts = db.prepare('SELECT book_id, COUNT(*) as count FROM book_comments GROUP BY book_id').all();
      db.close();
      const countMap = {};
      for (const c of counts) countMap[c.book_id] = c.count;
      return books.map(b => ({ ...b, comment_count: countMap[b.id] || 0 }));
    }
    case 'read_book': {
      const { book_id, page = 1, per_page = 10 } = args;
      const db = getDb(true);
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
      if (!book) { db.close(); return { error: 'Book not found' }; }
      const paras = db.prepare('SELECT idx, content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(book_id);
      const pages = [];
      let cur = [], curWeight = 0;
      for (const p of paras) {
        if (CHAPTER_RE.test(p.content.trim().substring(0, 60)) && cur.length > 0) { pages.push(cur); cur = []; curWeight = 0; }
        const lines = Math.max(1, Math.ceil(p.content.length / 22));
        if (curWeight + lines > per_page && cur.length > 0) { pages.push(cur); cur = []; curWeight = 0; }
        cur.push(p); curWeight += lines;
      }
      if (cur.length > 0) pages.push(cur);
      const totalPages = pages.length || 1;
      const p = Math.max(1, Math.min(page, totalPages));
      const pageParas = pages[p - 1] || [];
      const idxSet = new Set(pageParas.map(x => x.idx));
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, created_at').all(book_id)
        .filter(c => idxSet.has(c.paragraph_idx));
      db.close();
      const text = pageParas.map(x => `[${x.idx}] ${x.content}`).join('\n\n');
      const commentText = comments.length ? '\n---\nComments on this page:\n' + comments.map(c => `  [${c.from_who}@${c.paragraph_idx}] ${c.selected_text ? `"${c.selected_text}" → ` : ''}${c.content}`).join('\n') : '';
      return { book: book.title, page: p, totalPages, text: text + commentText };
    }
    case 'add_comment': {
      const { book_id, paragraph_idx, content, from_who = 'ai', selected_text, reply_to } = args;
      const db = getDb();
      let startIdx = null, endIdx = null;
      if (selected_text) {
        const para = db.prepare('SELECT content FROM book_paragraphs WHERE book_id = ? AND idx = ?').get(book_id, paragraph_idx);
        if (para?.content) { const i = para.content.indexOf(selected_text); if (i >= 0) { startIdx = i; endIdx = i + selected_text.length; } }
      }
      const result = db.prepare('INSERT INTO book_comments (book_id, paragraph_idx, sel_start_idx, sel_end_idx, selected_text, from_who, content, reply_to) VALUES (?,?,?,?,?,?,?,?)').run(book_id, paragraph_idx, startIdx, endIdx, selected_text || null, from_who, content, reply_to || null);
      db.close();
      return { ok: true, id: Number(result.lastInsertRowid) };
    }
    case 'list_comments': {
      const { book_id } = args;
      const db = getDb(true);
      const comments = db.prepare('SELECT * FROM book_comments WHERE book_id = ? ORDER BY paragraph_idx, created_at').all(book_id);
      db.close();
      return comments;
    }
    case 'get_toc': {
      const { book_id } = args;
      const db = getDb(true);
      const paras = db.prepare('SELECT idx, substr(content, 1, 100) as content FROM book_paragraphs WHERE book_id = ? ORDER BY idx').all(book_id);
      db.close();
      const chapters = [];
      for (const p of paras) {
        if (CHAPTER_RE.test(p.content.trim())) {
          chapters.push({ idx: p.idx, title: p.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) });
        }
      }
      return chapters;
    }
    case 'import_book': {
      const { title, content, format, data } = args;
      let paragraphs = [];
      let epubResult = null;
      if (format === 'epub' && data) { epubResult = parseEpub(data); paragraphs = epubResult.paragraphs; }
      else if (content) { paragraphs = smartSplit(content); }
      else return { error: 'content or epub data required' };
      if (!paragraphs.length) return { error: 'no paragraphs extracted' };
      const db = getDb();
      const r = db.prepare('INSERT INTO books (title, total_paragraphs) VALUES (?, ?)').run(title, paragraphs.length);
      const bookId = Number(r.lastInsertRowid);
      const ins = db.prepare('INSERT INTO book_paragraphs (book_id, idx, content) VALUES (?, ?, ?)');
      db.transaction(() => { for (let i = 0; i < paragraphs.length; i++) ins.run(bookId, i, paragraphs[i]); })();
      db.close();
      if (epubResult) {
        const imgDir = getImageDir(bookId);
        const images = extractImages(epubResult.zip, epubResult.epubImageMap, paragraphs);
        for (const [fname, d] of images) fs.writeFileSync(path.join(imgDir, fname), d);
        const cover = extractCover(epubResult.zip, epubResult.epubCoverFile);
        if (cover) {
          fs.writeFileSync(path.join(imgDir, cover.name), cover.data);
          const db2 = getDb();
          db2.prepare('UPDATE books SET cover_image = ? WHERE id = ?').run(cover.name, bookId);
          db2.close();
        }
      }
      return { ok: true, book_id: bookId, paragraphs: paragraphs.length };
    }
    case 'delete_comment': {
      const db = getDb();
      db.prepare('DELETE FROM book_comments WHERE id = ?').run(args.comment_id);
      db.close();
      return { ok: true };
    }
    case 'update_progress': {
      const db = getDb();
      db.prepare("INSERT INTO book_progress (book_id, page, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(book_id) DO UPDATE SET page = ?, updated_at = datetime('now')").run(args.book_id, args.page, args.page);
      db.close();
      return { ok: true };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// JSON-RPC stdio transport
let buffer = '';
process.stdin.setEncoding('utf8');

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

process.stdin.on('data', chunk => {
  buffer += chunk;
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
    try {
      const msg = JSON.parse(body);
      handleMessage(msg);
    } catch {}
  }
});

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'coread', version: '0.1.0' },
    }});
  } else if (msg.method === 'notifications/initialized') {
    // no-op
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    try {
      const result = handleTool(name, args || {});
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }});
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      }});
    }
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
}
