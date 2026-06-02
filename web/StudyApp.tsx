
import React, { useState, useEffect, useCallback, useRef, startTransition, useLayoutEffect } from 'react';
import { api } from './api';

function themeColors(h: number, s: number, l: number) {
    const primary = `hsl(${h}, ${s}%, ${l}%)`;
    const primaryLight = `hsl(${h}, ${s}%, 92%)`;
    const primaryBg = `hsl(${h}, ${Math.max(s - 5, 0)}%, 96%)`;
    const primaryBorder = `hsla(${h}, ${s}%, ${l}%, 0.18)`;
    const primaryDark = `hsl(${h}, ${s}%, ${Math.max(l - 18, 20)}%)`;
    const warmAccent = `hsl(${(h + 30) % 360}, ${Math.min(s + 10, 80)}%, 72%)`;
    const warmBg = `hsl(${(h + 30) % 360}, ${Math.min(s + 10, 80)}%, 94%)`;
    const grad1 = `hsl(${h}, ${Math.max(s - 5, 0)}%, 94%)`;
    const grad2 = `hsl(${(h + 20) % 360}, ${Math.max(s - 8, 0)}%, 92%)`;
    const grad3 = `hsl(${(h + 40) % 360}, ${Math.max(s - 12, 0)}%, 95%)`;
    const shenColor = `hsl(${h}, ${Math.min(s + 5, 60)}%, ${Math.max(l - 5, 35)}%)`;
    const shenBg = `hsl(${h}, ${Math.min(s + 5, 60)}%, 93%)`;
    const tongColor = `hsl(${(h + 150) % 360}, 45%, 55%)`;
    const tongBg = `hsl(${(h + 150) % 360}, 35%, 93%)`;
    const shenHL = `hsla(${h}, ${Math.min(s + 10, 55)}%, 82%, 0.5)`;
    const tongHL = `hsla(340, 50%, 82%, 0.5)`;
    return { primary, primaryLight, primaryBg, primaryBorder, primaryDark, warmAccent, warmBg, grad1, grad2, grad3, shenColor, shenBg, tongColor, tongBg, shenHL, tongHL };
}

interface Book { id: number; title: string; total_paragraphs: number; created_at: string; current_page: number | null; comment_count: number; }
interface Paragraph { idx: number; content: string; }
interface Comment { id: number; book_id: number; paragraph_idx: number; sel_end_para_idx: number | null; sel_start_idx: number | null; sel_end_idx: number | null; selected_text: string | null; from_who: string; content: string; created_at: string; reply_to: number | null; }
interface PageBreak { paraIndex: number; offset: number; }
interface PageFragment extends Paragraph { sourceIdx: number; startOffset: number; endOffset: number; isPartialStart: boolean; isPartialEnd: boolean; }
interface ReplyNotice {
    id: number;
    paragraph_idx: number;
    content: string;
    from_who?: string;
    created_at?: string;
    reply_to?: number | null;
    parent_id?: number | null;
    parent_from?: string;
    parent_content?: string;
    sel_start_idx?: number | null;
    sel_end_idx?: number | null;
    selected_text?: string | null;
    parent_paragraph_idx?: number | null;
    parent_sel_start_idx?: number | null;
    parent_sel_end_idx?: number | null;
    parent_selected_text?: string | null;
}

const BOOK_COVERS = [
    'linear-gradient(145deg, rgba(204,209,231,0.86), rgba(244,246,250,0.76))',
    'linear-gradient(145deg, rgba(231,201,213,0.86), rgba(250,244,247,0.76))',
    'linear-gradient(145deg, rgba(199,221,225,0.86), rgba(246,250,250,0.76))',
    'linear-gradient(145deg, rgba(214,225,207,0.86), rgba(248,250,245,0.76))',
    'linear-gradient(145deg, rgba(232,216,192,0.86), rgba(251,248,242,0.76))',
    'linear-gradient(145deg, rgba(212,203,230,0.86), rgba(248,246,251,0.76))',
];

const STUDY_THEME_CSS = `
.xiaowo-study {
    color: #41394f;
}
.xiaowo-study button {
    transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
}
.xiaowo-study button:active {
    transform: scale(0.98);
}
`;

const READER_PAGE_PADDING = '56px 28px calc(32px + env(safe-area-inset-bottom))';
const READER_VERTICAL_PADDING_STATIC = 88;
function getSafeAreaBottom(): number {
    if (typeof document === 'undefined') return 0;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;left:0;width:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    const h = probe.offsetHeight;
    document.body.removeChild(probe);
    return h;
}
const READER_HORIZONTAL_PADDING = 56;
function decodeEntities(s: string): string {
    return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const PARA_GAP = 18;
const CHAPTER_GAP_TOP = 40;
const CHAPTER_GAP_BOTTOM = 28;

function toast(msg: string) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, { position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 20px', borderRadius: '20px', fontSize: '13px', zIndex: '9999', pointerEvents: 'none', transition: 'opacity 0.3s' });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
}

const StudyApp: React.FC = () => {
    const c = themeColors(245, 25, 65);

    const [mode, setMode] = useState<'shelf' | 'reading'>('shelf');
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [activeBook, setActiveBook] = useState<Book | null>(null);
    const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
    const [comments, setComments] = useState<Comment[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [pageBreaks, setPageBreaks] = useState<PageBreak[]>([{ paraIndex: 0, offset: 0 }]);
    const [pageFragments, setPageFragments] = useState<PageFragment[]>([]);
    const [readingLoading, setReadingLoading] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [allParas, setAllParas] = useState<Paragraph[]>([]);
    const [allComments, setAllComments] = useState<Comment[]>([]);
    const [pageHeight, setPageHeight] = useState(0);
    const [readerSize, setReaderSize] = useState({ width: 0, height: 0 });
    const savedParaIdxRef = useRef<number | null>(null);
    const currentParaIdxRef = useRef<number | null>(null);

    const [commentingIdx, setCommentingIdx] = useState<number | null>(null);
    const [commentText, setCommentText] = useState('');
    const [selectedText, setSelectedText] = useState('');
    const [selRange, setSelRange] = useState<{ startPara: number; endPara: number; start: number; end: number } | null>(null);
    const [activeComments, setActiveComments] = useState<Comment[]>([]);
    const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
    const [newReplies, setNewReplies] = useState<ReplyNotice[]>([]);
    const [showReplies, setShowReplies] = useState(false);
    const [returnPoint, setReturnPoint] = useState<{ page: number; paraIdx: number | null } | null>(null);
    const [floatingBar, setFloatingBar] = useState<{ startPara: number; endPara: number; text: string; start: number; end: number } | null>(null);

    const [showToc, setShowToc] = useState(false);
    const [tocChapters, setTocChapters] = useState<{ idx: number; page: number; title: string }[]>([]);
    const commentsRef = useRef<Comment[]>([]);
    const allCommentsRef = useRef<Comment[]>([]);
    const suppressPageJumpRef = useRef(false);
    const replyPageRef = useRef<number | null>(null);

    const [showUpload, setShowUpload] = useState(false);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadText, setUploadText] = useState('');
    const [pdfBase64, setPdfBase64] = useState('');
    const [uploadFileName, setUploadFileName] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [selectedBooks, setSelectedBooks] = useState<Set<number>>(new Set());
    const batchFileRef = useRef<HTMLInputElement>(null);
    const [showBar, setShowBar] = useState(false);
    const [humanName, setHumanName] = useState(() => localStorage.getItem('coread-human-name') || 'human');
    const [aiName, setAiName] = useState(() => localStorage.getItem('coread-ai-name') || 'AI');
    const [showSettings, setShowSettings] = useState(false);
    const displayName = (from: string) => {
        const lower = from.toLowerCase();
        if (lower === 'human' || lower === humanName.toLowerCase()) return humanName;
        if (lower === 'ai' || lower === aiName.toLowerCase()) return aiName;
        return from;
    };
    const barTimer = useRef<any>(null);
    const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

    const toggleBar = () => {
        if (activeComments.length > 0) { setActiveComments([]); return; }
        if (floatingBar) return;
        setShowBar(prev => {
            const next = !prev;
            if (barTimer.current) clearTimeout(barTimer.current);
            if (next) barTimer.current = setTimeout(() => setShowBar(false), 5000);
            return next;
        });
    };

    useEffect(() => { loadBooks(); }, []);

    // Real-time comment sync — low-priority update, no flash
    useEffect(() => { commentsRef.current = comments; }, [comments]);
    useEffect(() => { allCommentsRef.current = allComments; }, [allComments]);

    const lastCommentIds = useRef('');
    useEffect(() => {
        if (mode !== 'reading' || !activeBook) return;
        const interval = setInterval(async () => {
            try {
                const vh = window.innerHeight || 700;
                const pp = Math.max(12, Math.min(28, Math.floor((vh - 120) / 26)));
                const d = await api.fetchBookDetail(activeBook.id, page, pp);
                if (d.comments) {
                    const newIds = d.comments.map((c: any) => c.id).join(',');
                    if (newIds !== lastCommentIds.current) {
                        lastCommentIds.current = newIds;
                        startTransition(() => {
                            const mergeComments = (prev: Comment[]) => {
                                const merged = new Map(prev.map(c => [c.id, c]));
                                d.comments.forEach((cmt: Comment) => {
                                    const tempDup = Array.from(merged.values()).find(c => c.id !== cmt.id && c.content === cmt.content && c.from_who === cmt.from_who && c.paragraph_idx === cmt.paragraph_idx && c.reply_to === cmt.reply_to && Math.abs(new Date(c.created_at).getTime() - new Date(cmt.created_at).getTime()) < 10000);
                                    if (tempDup) merged.delete(tempDup.id);
                                    merged.set(cmt.id, cmt);
                                });
                                return Array.from(merged.values());
                            };
                            setAllComments(mergeComments);
                            setComments(mergeComments);
                        });
                    }
                }
            } catch {}
        }, 3000);
        return () => clearInterval(interval);
    }, [mode, activeBook?.id, page]);

    // Poll for new replies from 沉
    useEffect(() => {
        if (mode !== 'reading' || !activeBook) return;
        const check = async () => {
            try {
                const lastSeen = parseInt(localStorage.getItem(`book-${activeBook.id}-last-seen`) || '0');
                const r = await fetch(`/v1/books/${activeBook.id}/new-replies?since=${lastSeen}`);
                if (r.ok) {
                    const d = await r.json();
                    const aiOnly = (d.replies || []).filter((r: any) => r.from_who.toLowerCase() !== humanName.toLowerCase());
                    setNewReplies(aiOnly.length ? aiOnly : []);
                }
            } catch {}
        };
        check();
        const interval = setInterval(check, 5000);
        return () => clearInterval(interval);
    }, [mode, activeBook?.id]);

    const dismissReplies = () => {
        if (activeBook && newReplies.length) {
            const maxId = Math.max(...newReplies.map(r => r.id));
            localStorage.setItem(`book-${activeBook.id}-last-seen`, String(maxId));
        }
        setNewReplies([]);
        setShowReplies(false);
    };

    const findPageForParaIdx = (paraIdx: number, maxPages = totalPages, charOffset = 0) => {
        const targetParaIdx = Number(paraIdx);
        const targetOffset = Number(charOffset) || 0;
        let paraIndex = allParas.findIndex(p => Number(p.idx) === targetParaIdx);
        if (paraIndex < 0) paraIndex = allParas.findIndex(p => Number(p.idx) >= targetParaIdx);
        if (paraIndex < 0) return -1;

        const lastPage = Math.min(maxPages, pageBreaks.length) - 1;
        for (let i = lastPage; i >= 0; i--) {
            const br = pageBreaks[i];
            if (br.paraIndex < paraIndex) return Math.max(0, i);
            if (br.paraIndex === paraIndex && br.offset <= targetOffset) return Math.max(0, i);
        }
        return 0;
    };

    const resolveNoticeTarget = (notice: ReplyNotice, pool: Comment[]) => {
        const existing = pool.find(c => c.id === notice.id);
        const replyTo = notice.reply_to ?? notice.parent_id ?? existing?.reply_to ?? null;
        const parent = replyTo ? pool.find(c => c.id === replyTo) : null;
        const target = parent || existing;
        const fallbackPara = Number(notice.parent_paragraph_idx ?? notice.paragraph_idx);
        const fallbackOffset = Number(notice.parent_sel_start_idx ?? notice.sel_start_idx);
        return {
            existing,
            replyTo,
            parent,
            paraIdx: Number(target?.paragraph_idx ?? fallbackPara),
            offset: Number.isFinite(Number(target?.sel_start_idx)) ? Number(target?.sel_start_idx) : (Number.isFinite(fallbackOffset) ? fallbackOffset : 0),
        };
    };

    const rememberReturnPoint = () => {
        setReturnPoint(prev => prev || { page, paraIdx: currentParaIdxRef.current ?? paragraphs[0]?.idx ?? null });
    };

    const returnToReadingPosition = () => {
        if (!returnPoint) return;
        setActiveComments([]);
        setShowReplies(false);
        setShowBar(false);
        const targetPage = returnPoint.paraIdx != null ? findPageForParaIdx(returnPoint.paraIdx) : -1;
        setPage(targetPage >= 0 ? targetPage + 1 : Math.max(1, Math.min(totalPages, returnPoint.page)));
        setReturnPoint(null);
    };

    const openReplyNotice = (notice: ReplyNotice) => {
        rememberReturnPoint();
        setShowReplies(false);
        setShowBar(false);
        const pool = Array.from(new Map([...allCommentsRef.current, ...commentsRef.current].map(c => [c.id, c])).values());
        const { existing, replyTo, parent, paraIdx: targetParaIdx, offset: targetOffset } = resolveNoticeTarget(notice, pool);
        const targetPage = findPageForParaIdx(targetParaIdx, totalPages, targetOffset);
        if (targetPage >= 0) setPage(targetPage + 1);
        const noticeComment: Comment = existing || {
            id: notice.id,
            book_id: activeBook?.id ?? 0,
            paragraph_idx: targetParaIdx,
            sel_end_para_idx: null,
            sel_start_idx: targetOffset,
            sel_end_idx: notice.parent_sel_end_idx ?? notice.sel_end_idx ?? null,
            selected_text: notice.parent_selected_text ?? notice.selected_text ?? null,
            from_who: notice.from_who || 'ai',
            content: notice.content,
            created_at: notice.created_at || new Date().toISOString(),
            reply_to: replyTo,
        };
        const thread = parent
            ? [parent, ...pool.filter(c => c.reply_to === parent.id || c.id === noticeComment.id)]
            : [noticeComment];
        setActiveComments(thread.some(c => c.id === noticeComment.id) ? thread : [...thread, noticeComment]);
        if (!existing) {
            setComments(prev => prev.some(c => c.id === noticeComment.id) ? prev : [...prev, noticeComment]);
            setAllComments(prev => prev.some(c => c.id === noticeComment.id) ? prev : [...prev, noticeComment]);
        }
    };

    // Selection change listener for floating annotation bar
    useEffect(() => {
        if (mode !== 'reading') return;
        const findPara = (n: Node): HTMLElement | null => {
            let el: HTMLElement | null = (n.nodeType === Node.TEXT_NODE ? n.parentElement : n) as HTMLElement;
            while (el && !(el as any).dataset?.paraIdx) el = el.parentElement;
            return el;
        };
        const handler = () => {
            const sel = window.getSelection();
            if (!sel || !sel.toString().trim() || sel.rangeCount === 0) { setFloatingBar(null); return; }
            const range = sel.getRangeAt(0);
            const startEl = findPara(range.startContainer);
            const endEl = findPara(range.endContainer);
            if (!startEl || !endEl) { setFloatingBar(null); return; }

            const startPara = parseInt((startEl as any).dataset.paraIdx);
            const endPara = parseInt((endEl as any).dataset.paraIdx);
            const text = sel.toString().trim();
            try {
                const pre1 = document.createRange();
                pre1.selectNodeContents(startEl);
                pre1.setEnd(range.startContainer, range.startOffset);
                const startBase = parseInt((startEl as any).dataset.fragStart || '0');
                const endBase = parseInt((endEl as any).dataset.fragStart || '0');
                const startOff = startBase + pre1.toString().length;

                let endOff: number;
                if (startPara === endPara) {
                    endOff = startOff + text.length;
                } else {
                    const pre2 = document.createRange();
                    pre2.selectNodeContents(endEl);
                    pre2.setEnd(range.endContainer, range.endOffset);
                    endOff = endBase + pre2.toString().length;
                }
                setFloatingBar({ startPara, endPara, text, start: startOff, end: endOff });
            } catch { setFloatingBar(null); }
        };
        document.addEventListener('selectionchange', handler);
        return () => document.removeEventListener('selectionchange', handler);
    }, [mode]);

    const loadBooks = async () => {
        setLoading(true); setError('');
        try { const d = await api.fetchBooks(); setBooks(d.books || []); }
        catch (e: any) { setError(e.message); }
        setLoading(false);
    };

    const openBook = async (book: Book) => {
        setActiveBook(book); setMode('reading');
        setReadingLoading(true);
        setPage(1); setTotalPages(1); setPageBreaks([{ paraIndex: 0, offset: 0 }]); setPageFragments([]);
        setParagraphs([]); setComments([]); setAllParas([]); setAllComments([]);
        currentParaIdxRef.current = null;
        {
            const bookTitle = book.title?.replace(/\s*\(.*?\)\s*/g, '').trim();
            fetch('/v1/reading-wishlist').then(r => r.json()).then(res => {
                const match = (res.items || []).find((w: any) => w.status === 'want' && w.title?.trim() === bookTitle);
                if (match) {
                    fetch('/v1/reading-wishlist', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: match.id, title: match.title, author: match.author, reason: match.reason, status: 'reading' }),
                    }).catch(() => {});
                }
            }).catch(() => {});
        }
        try {
            const d = await api.fetchBookSlice(book.id, 0, 9999);
            const isEpubJunk = (s: string) => /^(1UR057|Cover|封面|插图|导航|书名页|制作信息|Contents|[A-Z0-9]{3,10}(-\d+)?)$/.test(s.trim());
            const allP: Paragraph[] = (d.paragraphs || []).filter((p: Paragraph) => !isEpubJunk(p.content));
            // Hide TOC sections (目录 heading + consecutive chapter titles)
            const tocRe = /^(#\s*)?目录$/;
            const chRe = /^(第[\d一二三四五六七八九十百千万]+[章节回部篇]|序章|序$|终章|后记|尾声|附录|解说)/;
            let tocZone = false;
            const filtered = allP.filter(p => {
                const t = p.content.trim();
                if (tocRe.test(t)) { tocZone = true; return false; }
                if (tocZone) { if (chRe.test(t) || t === '') return false; tocZone = false; }
                return true;
            });
            setAllParas(filtered);
            setAllComments(d.comments || []);
            setComments(d.comments || []);
            const savedIdx = book.current_page || 0;
            // page will be set after measurement finds which page contains savedIdx
            savedParaIdxRef.current = savedIdx;
            setReadingLoading(false);
        } catch (e: any) { toast(`加载失败: ${e.message}`); setReadingLoading(false); }
        api.fetchBookToc(book.id).then(d => setTocChapters(d.chapters || [])).catch(() => {});
    };

    useLayoutEffect(() => {
        if (mode !== 'reading' || !contentRef.current) return;
        const el = contentRef.current;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const width = Math.round(el.clientWidth);
                const height = Math.max(0, Math.round(el.clientHeight - READER_VERTICAL_PADDING_STATIC - getSafeAreaBottom()));
                setReaderSize(prev => {
                    if (prev.width === width && prev.height === height) return prev;
                    if (prev.height > 0 && height < prev.height * 0.8 && width === prev.width) return prev;
                    return { width, height };
                });
            });
        };
        update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        ro?.observe(el);
        window.addEventListener('resize', update);
        return () => {
            cancelAnimationFrame(frame);
            ro?.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [mode]);

    const readerContentWidth = Math.max(1, readerSize.width - READER_HORIZONTAL_PADDING);

    const imgHeightCache = useRef<Map<string, number>>(new Map());

    const buildMeasureBlock = (para: Paragraph, sourceIdx: number, start: number, end: number) => {
        const heading = isHeading(para.content);
        const chapterTitle = isChapterStart(para.content);
        const outer = document.createElement('div');
        outer.style.marginTop = `${chapterTitle && start === 0 && sourceIdx > 0 ? CHAPTER_GAP_TOP : 0}px`;
        outer.style.marginBottom = `${chapterTitle ? CHAPTER_GAP_BOTTOM : PARA_GAP}px`;

        const imgMatch = para.content.match(/^\[IMG:([^\]]+)\]$/);
        if (imgMatch && start === 0) {
            const imgMaxH = Math.floor(readerSize.height * 0.6);
            const cachedH = imgHeightCache.current.get(imgMatch[1]);
            const h = cachedH ? Math.min(cachedH, imgMaxH) : imgMaxH;
            const imgEl = document.createElement('div');
            imgEl.style.height = `${h}px`;
            imgEl.style.width = '100%';
            outer.appendChild(imgEl);
        } else {
            const displayText = stripHeading(para.content).slice(start, end);
            const inner = document.createElement('div');
            inner.textContent = displayText || ' ';
            inner.style.fontSize = `${chapterTitle ? 18 : para.content.trim().startsWith('# ') ? 17 : para.content.trim().startsWith('## ') ? 16 : 14}px`;
            inner.style.lineHeight = String(chapterTitle ? 2.2 : 1.85);
            inner.style.letterSpacing = `${chapterTitle ? 1 : 0.3}px`;
            inner.style.textIndent = heading || chapterTitle || start > 0 ? '0' : '1.5em';
            inner.style.fontWeight = String(chapterTitle ? 800 : heading ? 700 : 400);
            inner.style.textAlign = chapterTitle ? 'center' : '';
            inner.style.whiteSpace = 'pre-wrap';
            outer.appendChild(inner);
        }


        return outer;
    };

    useEffect(() => {
        if (mode !== 'reading' || !measureRef.current || allParas.length === 0 || readerContentWidth <= 1 || readerSize.height <= 0) return;
        let cancelled = false;
        const run = async () => {
            await (document.fonts as any)?.ready?.catch(() => {});
            await new Promise<void>(r => requestAnimationFrame(() => r()));
            if (cancelled || !measureRef.current) return;

            if (activeBook) {
                const imgParas = allParas.filter(p => /^\[IMG:([^\]]+)\]$/.test(p.content));
                const loadPromises = imgParas.map(p => {
                    const m = p.content.match(/^\[IMG:([^\]]+)\]$/);
                    if (!m || imgHeightCache.current.has(m[1])) return Promise.resolve();
                    return new Promise<void>(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            const maxW = readerContentWidth;
                            const maxH = Math.floor(readerSize.height * 0.6);
                            const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
                            imgHeightCache.current.set(m![1], img.naturalHeight * scale);
                            resolve();
                        };
                        img.onerror = () => resolve();
                        img.src = api.imageUrl(activeBook!.id, m[1]);
                    });
                });
                await Promise.all(loadPromises);
            }
            if (cancelled || !measureRef.current) return;

            const measurer = measureRef.current;
            measurer.innerHTML = '';
            measurer.style.width = `${readerContentWidth}px`;
            const maxHeight = Math.max(100, readerSize.height - 8);
            setPageHeight(readerSize.height);

            const breaks: PageBreak[] = [{ paraIndex: 0, offset: 0 }];
            let paraIndex = 0;
            let offset = 0;

            const fits = (node: HTMLElement) => {
                measurer.appendChild(node);
                const ok = measurer.scrollHeight <= maxHeight + 1;
                measurer.removeChild(node);
                return ok;
            };

            while (paraIndex < allParas.length) {
                measurer.innerHTML = '';
                let progressed = false;
                while (paraIndex < allParas.length) {
                    const para = allParas[paraIndex];
                    const text = stripHeading(para.content);
                    if (offset === 0 && paraIndex > 0 && isChapterStart(para.content) && measurer.childElementCount > 0) break;

                    const full = buildMeasureBlock(para, paraIndex, offset, text.length);
                    if (fits(full)) {
                        measurer.appendChild(full);
                        paraIndex++;
                        offset = 0;
                        progressed = true;
                        continue;
                    }

                    if (offset >= text.length) {
                        paraIndex++;
                        offset = 0;
                        progressed = true;
                        continue;
                    }

                    let lo = Math.max(offset + 1, offset);
                    let hi = text.length;
                    let best = offset;
                    while (lo <= hi) {
                        const mid = Math.floor((lo + hi) / 2);
                        const part = buildMeasureBlock(para, paraIndex, offset, mid);
                        if (fits(part)) { best = mid; lo = mid + 1; }
                        else hi = mid - 1;
                    }
                    if (best === offset) best = Math.min(text.length, offset + 1);
                    // widow control: 段刚开始(offset===0)且这页只塞得下 <4 字 且这页已有别的内容 → 推整段下一页
                    if (offset === 0 && best > 0 && best < 4 && measurer.childElementCount > 0) {
                        break;
                    }
                    offset = best;
                    progressed = true;
                    break;
                }
                if (paraIndex < allParas.length) {
                    const nextBreak = { paraIndex, offset };
                    const last = breaks[breaks.length - 1];
                    if (last.paraIndex === nextBreak.paraIndex && last.offset === nextBreak.offset) break;
                    breaks.push(nextBreak);
                }
                if (!progressed) break;
            }

            if (cancelled) return;
            setPageBreaks(breaks);
            setTotalPages(Math.max(1, breaks.length));
            if (!suppressPageJumpRef.current) {
                const anchorIdx = savedParaIdxRef.current ?? currentParaIdxRef.current ?? allParas[0]?.idx ?? 0;
                const targetPage = (() => {
                    const pi = allParas.findIndex(p => p.idx >= anchorIdx);
                    if (pi < 0) return 0;
                    for (let i = breaks.length - 1; i >= 0; i--) if (breaks[i].paraIndex <= pi) return i;
                    return 0;
                })();
                setPage(Math.max(1, Math.min(breaks.length, targetPage + 1)));
            }
            savedParaIdxRef.current = null;
            setReadingLoading(false);
        };
        run();
        return () => { cancelled = true; };
    }, [mode, allParas, readerContentWidth, readerSize.height]);

    useEffect(() => {
        if (allParas.length === 0 || pageBreaks.length === 0) {
            setPageFragments([]);
            setParagraphs([]);
            setComments([]);
            currentParaIdxRef.current = null;
            return;
        }
        if (page > pageBreaks.length && !suppressPageJumpRef.current) {
            setPage(pageBreaks.length);
            return;
        }
        const start = pageBreaks[page - 1] || { paraIndex: 0, offset: 0 };
        const end = page < pageBreaks.length ? pageBreaks[page] : { paraIndex: allParas.length, offset: 0 };
        const fragments: PageFragment[] = [];
        for (let i = start.paraIndex; i < end.paraIndex || (i === end.paraIndex && end.offset > 0); i++) {
            const para = allParas[i];
            if (!para) continue;
            const text = stripHeading(para.content);
            const from = i === start.paraIndex ? start.offset : 0;
            const to = i === end.paraIndex ? end.offset : text.length;
            if (to <= from) continue;
            fragments.push({ ...para, content: text.slice(from, to), sourceIdx: i, startOffset: from, endOffset: to, isPartialStart: from > 0, isPartialEnd: to < text.length });
        }
        setPageFragments(fragments);
        const visibleParas = fragments.map(f => allParas[f.sourceIdx]).filter(Boolean);
        setParagraphs(visibleParas);
        setComments(allComments);
        currentParaIdxRef.current = visibleParas[0]?.idx ?? null;
        if (activeBook && visibleParas.length > 0) {
            api.updateBookProgress(activeBook.id, visibleParas[0].idx).catch(() => {});
        }
    }, [page, pageBreaks, allParas, allComments, activeBook?.id]);

    const goPage = (delta: number) => {
        if (!activeBook) return;
        const next = Math.max(1, Math.min(totalPages, page + delta));
        if (next !== page) {
            setActiveComments([]); setCommentingIdx(null); setSelRange(null); setFloatingBar(null);
            setPage(next);
            if (next === totalPages && totalPages > 1) {
                const bookTitle = activeBook.title?.replace(/\s*\(.*?\)\s*/g, '').trim();
                fetch('/v1/reading-wishlist').then(r => r.json()).then(res => {
                    const match = (res.items || []).find((w: any) => w.status === 'reading' && w.title?.trim() === bookTitle);
                    if (match) {
                        fetch('/v1/reading-wishlist', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: match.id, title: match.title, author: match.author, reason: match.reason, status: 'done' }),
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }
        }
    };

    const startAnnotation = () => {
        replyPageRef.current = page;
        if (!floatingBar) return;
        setSelRange({ startPara: floatingBar.startPara, endPara: floatingBar.endPara, start: floatingBar.start, end: floatingBar.end });
        setSelectedText(floatingBar.text);
        setCommentingIdx(floatingBar.startPara);
        setFloatingBar(null);
        window.getSelection()?.removeAllRanges();
    };

    const handleAddComment = async () => {
        if (!activeBook || commentingIdx === null || !commentText.trim()) return;
        try {
            const result = await api.addBookComment(activeBook.id, {
                paragraph_idx: commentingIdx, content: commentText.trim(), from_who: humanName,
                selected_text: selectedText || undefined,
                sel_start_idx: selRange ? selRange.start : undefined,
                sel_end_idx: selRange ? selRange.end : undefined,
                sel_end_para_idx: selRange && selRange.endPara !== selRange.startPara ? selRange.endPara : undefined,
                reply_to: replyingTo?.id || undefined,
            } as any);
            const newComment: Comment = {
                id: result?.id ?? Date.now(), book_id: activeBook.id, paragraph_idx: commentingIdx,
                sel_start_idx: selRange?.start ?? null, sel_end_idx: selRange?.end ?? null,
                sel_end_para_idx: selRange && selRange.endPara !== selRange.startPara ? selRange.endPara : null,
                selected_text: selectedText || null, from_who: humanName,
                content: commentText.trim(), created_at: new Date().toISOString(), reply_to: replyingTo?.id ?? null,
            };
            const pageToRestore = replyPageRef.current ?? page;
            replyPageRef.current = null;
            suppressPageJumpRef.current = true;
            setCommentText(''); setSelectedText(''); setSelRange(null); setReplyingTo(null);
            setActiveComments([]); setCommentingIdx(null);
            setComments(prev => [...prev, newComment]);
            setAllComments(prev => [...prev, newComment]);
            setPage(pageToRestore);
            setTimeout(() => { suppressPageJumpRef.current = false; }, 500);
        } catch (e: any) { toast(`批注失败: ${e.message}`); }
    };

    const handleDeleteComment = async (cmt: Comment) => {
        try {
            await api.deleteBookComment(cmt.id);
            setComments(prev => prev.filter(x => x.id !== cmt.id));
            setAllComments(prev => prev.filter(x => x.id !== cmt.id));
            setActiveComments(prev => prev.filter(x => x.id !== cmt.id));
        } catch (e: any) { toast(`删除失败: ${e.message}`); }
    };

    const handleExport = () => {
        if (!activeBook) return;
        window.open(`/v1/books/${activeBook.id}/export?format=epub`, '_blank');
    };

    const handleDeleteBook = async (bookId: number) => {
        try {
            await api.deleteBook(bookId);
            setConfirmDelete(null); loadBooks();
            toast('已删除');
        } catch (e: any) { toast(`删除失败: ${e.message}`); }
    };

    const jumpToChapter = (chapter: { idx: number; page: number; title: string }) => {
        if (!activeBook) return;
        setShowToc(false); setActiveComments([]); setCommentingIdx(null); setSelRange(null); setFloatingBar(null);
        const targetIdx = chapter.idx ?? chapter.page;
        const targetPage = findPageForParaIdx(targetIdx);
        if (targetPage >= 0) setPage(targetPage + 1);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const name = file.name.replace(/\.(pdf|txt|md|epub)$/i, '');
        if (!uploadTitle) setUploadTitle(name);
        setUploadFileName(file.name);
        const ext = file.name.toLowerCase().split('.').pop();

        if (ext === 'pdf' || ext === 'epub') {
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = (reader.result as string).split(',')[1];
                setPdfBase64(b64); setUploadText('');
            };
            reader.readAsDataURL(file);
        } else {
            file.arrayBuffer().then(buf => {
                const bytes = new Uint8Array(buf);
                let text: string;
                try {
                    const utf8 = new TextDecoder('utf-8', { fatal: true });
                    text = utf8.decode(bytes);
                } catch {
                    const gbk = new TextDecoder('gbk');
                    text = gbk.decode(bytes);
                }
                setUploadText(text); setPdfBase64('');
            });
        }
    };

    const handleBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setUploading(true);
        let ok = 0, fail = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.toLowerCase().split('.').pop();
            if (!['epub', 'pdf', 'txt', 'md'].includes(ext || '')) { fail++; continue; }
            try {
                const title = file.name.replace(/\.(pdf|txt|md|epub)$/i, '');
                const b64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                });
                const payload: any = { title };
                if (ext === 'epub') { payload.format = 'epub'; payload.data = b64; }
                else if (ext === 'pdf') { payload.format = 'pdf'; payload.data = b64; }
                else { payload.content = atob(b64); }
                await api.createBook(payload);
                ok++;
                toast(`已上传 ${ok}/${files.length}: ${title}`);
            } catch { fail++; }
        }
        toast(fail ? `完成：${ok}成功，${fail}失败` : `全部${ok}本上传成功`);
        setUploading(false);
        setShowUpload(false);
        loadBooks();
        e.target.value = '';
    };

    const handleUpload = async () => {
        if (!uploadTitle.trim()) { toast('请输入书名'); return; }
        if (!uploadText && !pdfBase64) { toast('请选择文件或粘贴文本'); return; }
        setUploading(true);
        try {
            const payload: any = { title: uploadTitle.trim() };
            if (pdfBase64 && uploadFileName.toLowerCase().endsWith('.epub')) { payload.format = 'epub'; payload.data = pdfBase64; }
            else if (pdfBase64) { payload.format = 'pdf'; payload.data = pdfBase64; }
            else { payload.content = uploadText; }
            await api.createBook(payload);
            setShowUpload(false); setUploadTitle(''); setUploadText(''); setPdfBase64(''); setUploadFileName('');
            toast('上传成功');
            loadBooks();
        } catch (e: any) { toast(`上传失败: ${e.message}`); }
        setUploading(false);
    };

    const backToShelf = () => {
        setMode('shelf'); setActiveBook(null); setParagraphs([]); setComments([]);
        setActiveComments([]); setSelRange(null); setFloatingBar(null); setShowToc(false); setTocChapters([]);
        setReturnPoint(null);
        loadBooks();
    };

    const commentsForPara = (idx: number) => comments.filter(x => {
        if (x.sel_start_idx == null) return x.paragraph_idx === idx;
        const endPara = x.sel_end_para_idx ?? x.paragraph_idx;
        return x.paragraph_idx <= idx && idx <= endPara;
    });
    const stripHeading = (s: string) => s.replace(/^#+\s*/, '');
    const isHeading = (s: string) => s.trim().startsWith('#');
    const isChapterStart = (s: string) => {
        const trimmed = s.trim();
        const plain = stripHeading(trimmed).trim();
        const isChapter = /^(chapter|book|part|volume|prologue|epilogue)\b/i.test(plain)
            || /^\u7b2c[\d\s\w\u4e00-\u9fff]{1,20}[\u7ae0\u8282\u5377\u90e8\u7bc7\u56de]/.test(plain)
            || /^\u7b2c\d+\u7ae0/.test(trimmed);
        if (isChapter) return true;
        const heading = trimmed.match(/^(#{1,6})\s+/);
        return !!(heading && heading[1].length <= 2);
    };

    const renderHighlighted = (text: string, paraIdx: number, highlights: Comment[]) => {
        const positioned = highlights
            .filter(h => h.sel_start_idx != null && h.sel_end_idx != null && h.sel_start_idx! < text.length)
            .sort((a, b) => a.sel_start_idx! - b.sel_start_idx!);
        if (positioned.length === 0) return text;

        const parts: React.ReactNode[] = [];
        let lastEnd = 0;
        for (const h of positioned) {
            const start = Math.max(h.sel_start_idx!, lastEnd);
            const end = Math.min(h.sel_end_idx!, text.length);
            if (start >= end) continue;
            if (start > lastEnd) parts.push(<React.Fragment key={`t${paraIdx}-${lastEnd}`}>{text.slice(lastEnd, start)}</React.Fragment>);

            const isShen = h.from_who.toLowerCase() === 'ai' || h.from_who.toLowerCase() === aiName.toLowerCase();
            const hlBg = isShen ? c.shenHL : c.tongHL;
            const dotColor = isShen ? c.shenColor : c.tongColor;

            const showDot = h.paragraph_idx === paraIdx;
            const hStart = start, hEnd = end;
            parts.push(
                <span key={`h${h.id}-${paraIdx}`}
                    onClick={(e) => {
                        if (window.getSelection()?.toString().trim()) return;
                        e.stopPropagation();
                        const overlapping = positioned.filter(x => {
                            const xs = Math.max(x.sel_start_idx!, 0), xe = Math.min(x.sel_end_idx!, text.length);
                            return xs < hEnd && xe > hStart;
                        });
                        const allReplies: Comment[] = [];
                        const findReplies = (ids: number[]) => { const found = comments.filter(r => r.reply_to && ids.includes(r.reply_to)); if (found.length) { allReplies.push(...found); findReplies(found.map(f => f.id)); } };
                        findReplies(overlapping.map(o => o.id));
                        const withReplies = [...overlapping, ...allReplies];
                        setActiveComments(prev => prev.length > 0 && prev[0]?.id === overlapping[0]?.id ? [] : withReplies);
                    }}
                    style={{
                        backgroundImage: `linear-gradient(${hlBg}, ${hlBg})`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '100% 62%',
                        backgroundPosition: '0 72%',
                        borderRadius: 3,
                        position: 'relative',
                        cursor: 'pointer',
                        textDecorationLine: 'none',
                        padding: 0,
                        lineHeight: 'inherit',
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                    } as React.CSSProperties}>
                    {showDot && <span style={{ position: 'absolute', top: -2, left: -2, width: 7, height: 7, borderRadius: '50%', background: dotColor, boxShadow: `0 0 3px ${dotColor}60`, pointerEvents: 'none' }} />}
                    {text.slice(start, end)}
                </span>
            );
            lastEnd = end;
        }
        if (lastEnd < text.length) parts.push(<React.Fragment key={`t${paraIdx}-${lastEnd}`}>{text.slice(lastEnd)}</React.Fragment>);
        return <>{parts}</>;
    };

    const btnBase: React.CSSProperties = {
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(18px) saturate(1.05)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.05)',
        border: `1px solid ${c.primaryBorder}`, borderRadius: 14,
        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    };

    return (
        <div className="xiaowo-study" style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: mode === 'reading' ? '#fafaf8' : `linear-gradient(145deg, rgba(255,252,254,0.98), ${c.grad1} 48%, rgba(239,247,248,0.96))`, position: 'relative', overflow: 'hidden' }}>
            <style>{`${STUDY_THEME_CSS}\n@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }`}</style>
            {mode !== 'reading' && <>
                <div style={{ position: 'absolute', top: -70, right: -40, width: 210, height: 210, borderRadius: '50%', background: `radial-gradient(circle, ${c.primaryLight}34, transparent 68%)`, pointerEvents: 'none', filter: 'blur(12px)', opacity: 0.7 }} />
                <div style={{ position: 'absolute', bottom: 70, left: -70, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${c.warmBg}34, transparent 68%)`, pointerEvents: 'none', filter: 'blur(12px)', opacity: 0.65 }} />
            </>}

            {/* Header — shelf always shows; reading mode header slides with toolbar */}
            {mode === 'shelf' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 'calc(52px + env(safe-area-inset-top))', paddingLeft: 20, paddingRight: 20, paddingBottom: 12, flexShrink: 0 }}>
                    <button onClick={() => window.history.back()} style={btnBase}>
                        <span style={{ fontSize: 18, color: c.primary }}>‹</span>
                    </button>
                    <span style={{ fontSize: 16, fontWeight: 700, color: c.primaryDark, flex: 1 }}>共读室</span>
                    {editMode && selectedBooks.size > 0 && (
                        <button onClick={async () => {
                            if (!confirm(`删除选中的 ${selectedBooks.size} 本书？`)) return;
                            for (const id of selectedBooks) {
                                try { await fetch(`/v1/books/${id}`, { method: 'DELETE' }); } catch {}
                            }
                            setSelectedBooks(new Set()); setEditMode(false); loadBooks();
                            toast(`已删除 ${selectedBooks.size} 本`);
                        }} style={{ ...btnBase, background: '#e55', border: 'none' }}>
                            <span style={{ fontSize: 12, color: 'white', fontWeight: 600 }}>删除{selectedBooks.size}</span>
                        </button>
                    )}
                    <button onClick={() => { setEditMode(!editMode); setSelectedBooks(new Set()); }} style={btnBase}>
                        <span style={{ fontSize: 12, color: editMode ? '#e55' : c.primary, fontWeight: 600 }}>{editMode ? '完成' : '管理'}</span>
                    </button>
                    <button onClick={() => setShowSettings(true)} style={btnBase}>
                        <span style={{ fontSize: 14, color: c.primary }}>⚙</span>
                    </button>
                    <button onClick={() => setShowUpload(true)} style={btnBase}>
                        <span style={{ fontSize: 20, color: c.primary, lineHeight: 1 }}>+</span>
                    </button>
                </div>
            ) : (
                <>
                    {/* Persistent book title — always visible, small grey text */}
                    <div style={{
                        paddingTop: 'calc(12px + env(safe-area-inset-top))', paddingLeft: 20, paddingRight: 20, paddingBottom: 6, textAlign: 'center', flexShrink: 0,
                        background: '#fafaf8',
                    }}>
                        <div style={{ fontSize: 11, color: '#aaa', letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {activeBook?.title || ''}
                        </div>
                    </div>
                    {/* Sliding exit button — top right, only shows with toolbar */}
                    <div style={{
                        position: 'absolute', top: 44, right: 12, zIndex: 15,
                        opacity: showBar ? 1 : 0, transform: showBar ? 'translateY(0)' : 'translateY(-20px)',
                        transition: 'opacity 0.3s ease, transform 0.3s ease',
                        pointerEvents: showBar ? 'auto' : 'none',
                    }}>
                        <button onClick={backToShelf} style={btnBase}>
                            <span style={{ fontSize: 16, color: c.primary }}>✕</span>
                        </button>
                    </div>
                </>
            )}

            {/* Content */}
            <div ref={contentRef} style={{
                flex: 1, overflow: mode === 'reading' ? 'hidden' : 'auto', position: 'relative',
                padding: mode === 'reading' ? '0' : '8px 20px 32px',
                background: mode === 'reading' ? '#fafaf8' : 'transparent',
            }} className="no-scrollbar study-scroll-container"
                onClick={() => { if (mode === 'reading') toggleBar(); else if (activeComments.length) setActiveComments([]); }}
                onTouchStart={mode === 'reading' ? (e) => {
                    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
                } : undefined}
                onTouchEnd={mode === 'reading' ? (e) => {
                    if (!touchStart.current) return;
                    const dx = e.changedTouches[0].clientX - touchStart.current.x;
                    const dy = e.changedTouches[0].clientY - touchStart.current.y;
                    const dt = Date.now() - touchStart.current.t;
                    touchStart.current = null;
                    if (dt > 500 || Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 60) return;
                    if (dx < -60) goPage(1);
                    else if (dx > 60) goPage(-1);
                } : undefined}>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: '#bbb', fontSize: 14 }}>加载中...</div>
                ) : error ? (
                    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <div style={{ fontSize: 13, color: '#e88', marginBottom: 12 }}>{error}</div>
                        <button onClick={loadBooks} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '8px 20px', fontSize: 12, color: c.primary, cursor: 'pointer' }}>重试</button>
                    </div>
                ) : mode === 'shelf' ? (
                    <>
                        {books.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bbb' }}>
                                <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(135deg, ${c.primaryLight}, ${c.warmBg})`, margin: '0 auto 16px' }} />
                                <div style={{ fontSize: 14, marginBottom: 6 }}>书架空空的</div>
                                <div style={{ fontSize: 12, color: '#ccc' }}>点右上角 + 上传一本书</div>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                {[...books].sort((a, b) => {
                                    const aTime = a.last_read_at ? new Date(a.last_read_at).getTime() : 0;
                                    const bTime = b.last_read_at ? new Date(b.last_read_at).getTime() : 0;
                                    if (aTime || bTime) { if (aTime !== bTime) return bTime - aTime; }
                                    return b.id - a.id;
                                }).map((book, i) => {
                                    const progress = book.current_page && book.total_paragraphs > 0
                                        ? Math.round(((book.current_page * 10) / book.total_paragraphs) * 100) : 0;
                                    return (
                                        <div key={book.id} style={{ position: 'relative' }}>
                                            <button onClick={() => {
                                                if (editMode) {
                                                    setSelectedBooks(prev => { const s = new Set(prev); s.has(book.id) ? s.delete(book.id) : s.add(book.id); return s; });
                                                } else openBook(book);
                                            }} style={{
                                                background: 'none', padding: 0, border: 'none', cursor: 'pointer',
                                                textAlign: 'left', display: 'flex', flexDirection: 'column', width: '100%',
                                            }}>
                                                <div style={{ width: '100%', aspectRatio: '2/3', borderRadius: '4px 12px 12px 4px', overflow: 'hidden', position: 'relative', background: book.cover_image ? '#f0ebe3' : BOOK_COVERS[i % BOOK_COVERS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '3px 3px 12px rgba(0,0,0,0.18), inset -2px 0 4px rgba(0,0,0,0.05)', borderLeft: `4px solid ${book.cover_image ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.08)'}`, opacity: editMode && selectedBooks.has(book.id) ? 0.6 : 1 }}>
                                                    {editMode && (
                                                        <div style={{ position: 'absolute', top: 6, left: 8, width: 22, height: 22, borderRadius: '50%', background: selectedBooks.has(book.id) ? c.primary : 'rgba(255,255,255,0.7)', border: `2px solid ${selectedBooks.has(book.id) ? c.primary : 'rgba(0,0,0,0.2)'}`, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {selectedBooks.has(book.id) && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                                                        </div>
                                                    )}
                                                    {book.cover_image ? (
                                                        <img src={api.imageUrl(book.id, book.cover_image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <span style={{ fontSize: 22, fontWeight: 800, color: 'rgba(82,74,96,0.36)', padding: 8, textAlign: 'center', lineHeight: 1.3, wordBreak: 'break-all' }}>{book.title.slice(0, 4)}</span>
                                                    )}
                                                    {book.comment_count > 0 && (
                                                        <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: '1px 6px', fontSize: 9, fontWeight: 700, color: c.primaryDark }}>
                                                            {book.comment_count}
                                                        </div>
                                                    )}
                                                    {progress > 0 && (
                                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.1)' }}>
                                                            <div style={{ height: '100%', width: `${Math.min(progress, 100)}%`, background: c.primary, borderRadius: '0 2px 2px 0' }} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ padding: '8px 2px 0', overflow: 'hidden' }}>
                                                    <div style={{ fontSize: 11, fontWeight: 600, color: c.primaryDark, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as any}>{book.title}</div>
                                                </div>
                                            </button>
                                            {!editMode && (
                                                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(book.id); }}
                                                    style={{ position: 'absolute', top: 4, left: 8, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.4)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <span style={{ color: 'white', fontSize: 12, lineHeight: 1 }}>×</span>
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : (
                    /* Reading Mode — immersive, no card border */
                    <>
                        {readingLoading && allParas.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>加载中...</div>
                        ) : allParas.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 14 }}>这一页没有内容</div>
                        ) : (
                            <div data-page-content style={{ padding: READER_PAGE_PADDING, height: '100%', minHeight: pageHeight || undefined, boxSizing: 'border-box', overflow: 'hidden' }}>
                                {pageFragments.map((frag, visibleIndex) => {
                                    const original = allParas[frag.sourceIdx] || frag;
                                    const heading = isHeading(original.content) && !frag.isPartialStart;
                                    const chapterTitle = isChapterStart(original.content) && !frag.isPartialStart;
                                    const rawInline = commentsForPara(frag.idx).filter(x => x.sel_start_idx != null && x.sel_end_idx != null);
                                    const inlineComments = rawInline.map(h => {
                                        const endPara = h.sel_end_para_idx ?? h.paragraph_idx;
                                        let s = h.sel_start_idx!, e = h.sel_end_idx!;
                                        if (h.paragraph_idx === frag.idx && endPara === frag.idx) { /* single para */ }
                                        else if (h.paragraph_idx === frag.idx) { e = frag.endOffset; }
                                        else if (endPara === frag.idx) { s = frag.startOffset; }
                                        else { s = frag.startOffset; e = frag.endOffset; }
                                        return { ...h, sel_start_idx: s - frag.startOffset, sel_end_idx: e - frag.startOffset };
                                    }).filter(h => h.sel_end_idx! > 0 && h.sel_start_idx! < frag.content.length);

                                    const blockComments = commentsForPara(frag.idx).filter(x => (x.sel_start_idx == null || x.sel_end_idx == null) && x.paragraph_idx === frag.idx && !frag.isPartialStart);

                                    const imgMatch = frag.content.match(/^\[IMG:([^\]]+)\]$/);
                                    if (imgMatch && activeBook) {
                                        const imgUrl = api.imageUrl(activeBook.id, imgMatch[1]);
                                        return (
                                            <div key={`${frag.idx}-${frag.startOffset}-${frag.endOffset}`} style={{ marginBottom: PARA_GAP, textAlign: 'center' }}>
                                                <img src={imgUrl} alt="" style={{ maxWidth: '100%', maxHeight: `${Math.floor(readerSize.height * 0.6)}px`, objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8 }} />
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={`${frag.idx}-${frag.startOffset}-${frag.endOffset}`} style={{ marginBottom: chapterTitle ? CHAPTER_GAP_BOTTOM : PARA_GAP, marginTop: chapterTitle && visibleIndex > 0 ? CHAPTER_GAP_TOP : 0 }}>
                                            <div data-para-idx={frag.idx} data-frag-start={frag.startOffset} data-frag-end={frag.endOffset} style={{
                                                fontSize: chapterTitle ? 18 : original.content.trim().startsWith('# ') ? 17 : original.content.trim().startsWith('## ') ? 16 : 14,
                                                lineHeight: chapterTitle ? 2.2 : 1.85, color: heading ? '#222' : '#333',
                                                letterSpacing: chapterTitle ? 1 : 0.3, textIndent: (heading || chapterTitle || frag.isPartialStart) ? 0 : '1.5em',
                                                fontWeight: chapterTitle ? 800 : heading ? 700 : 400, marginBottom: heading ? 4 : 0,
                                                textAlign: chapterTitle ? 'center' : undefined,
                                                userSelect: 'text', WebkitUserSelect: 'text', whiteSpace: 'pre-wrap',
                                            } as any}>
                                                {renderHighlighted(decodeEntities(frag.content), frag.idx, inlineComments)}
                                            </div>

                                            {blockComments.length > 0 && (
                                                <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    {blockComments.filter(x => !x.reply_to).map(cmt => {
                                                        const isShen = cmt.from_who.toLowerCase() === 'ai' || cmt.from_who.toLowerCase() === aiName.toLowerCase();
                                                        const color = isShen ? c.shenColor : c.tongColor;
                                                        return (
                                                            <span key={cmt.id} onClick={(e) => { e.stopPropagation(); const allR: Comment[] = []; const findR = (ids: number[]) => { const f = comments.filter(r => r.reply_to && ids.includes(r.reply_to)); if (f.length) { allR.push(...f); findR(f.map(x => x.id)); } }; findR([cmt.id]); setActiveComments(prev => prev.length > 0 && prev[0]?.id === cmt.id ? [] : [cmt, ...allR]); }}
                                                                style={{ width: 8, height: 8, borderRadius: '50%', background: color, cursor: 'pointer', display: 'inline-block', opacity: 0.7 }} />
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
                {mode === 'reading' && (
                    <div ref={measureRef} aria-hidden style={{
                        position: 'absolute',
                        top: -99999,
                        left: 0,
                        width: readerContentWidth,
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        zIndex: -1,
                        boxSizing: 'border-box',
                        whiteSpace: 'normal',
                    }} />
                )}
            </div>

            {/* Floating annotation bar — appears when text is selected */}
            {floatingBar && mode === 'reading' && commentingIdx === null && (
                <div style={{
                    position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    background: c.primary, borderRadius: 20, padding: '10px 24px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 25, cursor: 'pointer',
                }}
                    onPointerDown={(e) => { e.preventDefault(); startAnnotation(); }}>
                    <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>添加批注</span>
                </div>
            )}

            {mode === 'reading' && commentingIdx !== null && !replyingTo && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', left: 16, right: 16, bottom: 20, zIndex: 32,
                    background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: 16, border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
                }}>
                    {selectedText && (
                        <div style={{ fontSize: 12, color: '#777', fontStyle: 'italic', marginBottom: 10, padding: '8px 10px', background: c.tongHL, borderRadius: 12, lineHeight: 1.5, borderLeft: `3px solid ${c.tongColor}60`, maxHeight: 96, overflow: 'auto' }} className="no-scrollbar">
                            {selectedText.length > 160 ? selectedText.slice(0, 160) + '...' : selectedText}
                        </div>
                    )}
                    <textarea value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="写下你的想法..."
                        style={{ width: '100%', minHeight: 72, border: 'none', background: 'transparent', fontSize: 14, color: '#444', resize: 'none', outline: 'none', lineHeight: 1.6 }} autoFocus />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                        <button onClick={() => { setCommentingIdx(null); setCommentText(''); setSelectedText(''); setSelRange(null); }}
                            style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '7px 16px', fontSize: 12, color: '#999', cursor: 'pointer' }}>取消</button>
                        <button onClick={handleAddComment}
                            style={{ background: c.primary, border: 'none', borderRadius: 12, padding: '7px 18px', fontSize: 12, color: 'white', cursor: 'pointer', fontWeight: 600, opacity: commentText.trim() ? 1 : 0.5 }}>保存</button>
                    </div>
                </div>
            )}

            {/* Note popup — shows all overlapping annotations */}
            {activeComments.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', bottom: 20, left: 16, right: 16,
                    background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: '16px 20px', border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.08)', zIndex: 20, maxHeight: '50vh', overflow: 'auto',
                }} className="no-scrollbar">
                    <button onClick={() => setActiveComments([])} style={{ position: 'absolute', top: 10, right: 14, background: 'none', border: 'none', fontSize: 18, color: '#ccc', cursor: 'pointer', lineHeight: 1, zIndex: 1 }}>×</button>
                    {(() => {
                        const topLevel = activeComments.filter(ac => !ac.reply_to);
                        const replies = activeComments.filter(ac => ac.reply_to);
                        const renderComment = (ac: Comment, indent: boolean) => {
                            const isShen = ac.from_who.toLowerCase() === 'ai' || ac.from_who.toLowerCase() === aiName.toLowerCase();
                            const color = isShen ? c.shenColor : c.tongColor;
                            const bg = isShen ? c.shenBg : c.tongBg;
                            return (
                                <div key={ac.id} style={{ marginLeft: indent ? 28 : 0, marginBottom: 12, paddingBottom: 12, borderBottom: indent ? 'none' : `1px solid ${c.primaryBorder}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                        <span style={{ width: 24, height: 24, borderRadius: '50%', background: bg, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color }}>{displayName(ac.from_who).charAt(0)}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color }}>{displayName(ac.from_who)}</span>
                                        <span style={{ fontSize: 10, color: '#ccc' }}>{ac.created_at?.slice(0, 16).replace('T', ' ')}</span>
                                    </div>
                                    {ac.selected_text && (
                                        <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', padding: '8px 12px', marginBottom: 10, background: isShen ? c.shenHL : c.tongHL, borderRadius: 12, lineHeight: 1.5, borderLeft: `3px solid ${color}50` }}>
                                            {ac.selected_text}
                                        </div>
                                    )}
                                    <div style={{ fontSize: 14, color: '#333', lineHeight: 1.7, marginBottom: 8 }}>{ac.content}</div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                        <button onClick={() => { replyPageRef.current = page; setReplyingTo(ac); setCommentingIdx(ac.paragraph_idx); setCommentText(''); }} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '4px 14px', fontSize: 11, color: c.primary, cursor: 'pointer' }}>回复</button>
                                        {!isShen && (
                                            <button onClick={() => handleDeleteComment(ac)} style={{ background: 'none', border: '1px solid #f0d0d0', borderRadius: 10, padding: '4px 14px', fontSize: 11, color: '#d88', cursor: 'pointer' }}>删除</button>
                                        )}
                                    </div>
                                </div>
                            );
                        };
                        const renderThread = (parent: Comment, depth: number) => (
                            <React.Fragment key={parent.id}>
                                {renderComment(parent, depth > 0)}
                                {replies.filter(r => r.reply_to === parent.id).map(r => renderThread(r, depth + 1))}
                            </React.Fragment>
                        );
                        return topLevel.map(ac => renderThread(ac, 0));
                    })()}
                    {replyingTo && (
                        <div style={{ marginTop: 8, padding: '10px 12px', background: c.primaryBg, borderRadius: 14, border: `1px solid ${c.primaryBorder}` }}>
                            <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>回复 {displayName(replyingTo.from_who)}：{replyingTo.content.slice(0, 30)}{replyingTo.content.length > 30 ? '…' : ''}</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="写回复…" style={{ flex: 1, border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '6px 12px', fontSize: 13, outline: 'none' }} onKeyDown={e => e.key === 'Enter' && handleAddComment()} />
                                <button onClick={handleAddComment} style={{ background: c.primary, color: '#fff', border: 'none', borderRadius: 10, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>发送</button>
                                <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: `1px solid ${c.primaryBorder}`, borderRadius: 10, padding: '6px 10px', fontSize: 12, color: '#999', cursor: 'pointer' }}>×</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {mode === 'reading' && returnPoint && (
                <button onClick={(e) => { e.stopPropagation(); returnToReadingPosition(); }} style={{
                    position: 'absolute', top: 44, left: 12, zIndex: 28,
                    background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)',
                    border: `1px solid ${c.primaryBorder}`, borderRadius: 16,
                    padding: '7px 12px', color: c.primary, fontSize: 12, fontWeight: 700,
                    boxShadow: '0 4px 18px rgba(0,0,0,0.08)', cursor: 'pointer',
                }}>
                    返回阅读位置
                </button>
            )}

            {/* New replies notification bubble */}
            {mode === 'reading' && newReplies.length > 0 && !showReplies && (
                <div onClick={(e) => { e.stopPropagation(); setShowReplies(true); }} style={{
                    position: 'absolute', bottom: showBar ? 72 : 22, right: 16, zIndex: 30,
                    background: c.shenColor, borderRadius: 20, padding: '8px 14px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6,
                    animation: 'pulse 2s ease-in-out infinite',
                    transition: 'bottom 0.3s ease',
                }}>
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>CC · {newReplies.length} 条新互动</span>
                </div>
            )}

            {/* New replies panel */}
            {showReplies && newReplies.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', bottom: 20, right: 16, left: 16, zIndex: 30,
                    background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(24px)',
                    borderRadius: 20, padding: '16px 18px', border: `1px solid ${c.primaryBorder}`,
                    boxShadow: '0 -4px 32px rgba(0,0,0,0.1)', maxHeight: '55vh', overflow: 'auto',
                }} className="no-scrollbar">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: c.shenColor }}>最新批注回复</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={dismissReplies} style={{ background: c.primaryBg, border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '5px 14px', fontSize: 11, color: '#999', cursor: 'pointer' }}>已读</button>
                            <button onClick={() => setShowReplies(false)} style={{ background: c.primaryBg, border: `1px solid ${c.primaryBorder}`, borderRadius: 12, padding: '5px 14px', fontSize: 11, color: '#999', cursor: 'pointer' }}>收起</button>
                        </div>
                    </div>
                    {newReplies.map(r => (
                        <div key={r.id} onClick={() => openReplyNotice(r)} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${c.primaryBorder}`, cursor: 'pointer' }}>
                            {r.parent_content && (
                                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, padding: '4px 10px', background: c.tongBg, borderRadius: 8, borderLeft: `3px solid ${c.tongColor}` }}>
                                    {r.parent_from}: {r.parent_content.length > 40 ? r.parent_content.slice(0, 40) + '...' : r.parent_content}
                                </div>
                            )}
                            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{r.content}</div>
                            <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>p{r.paragraph_idx} · 点开定位到原文</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Bottom toolbar — iOS Books style, slides up on tap */}
            {mode === 'reading' && (
                <>
                    {/* Page number — always visible at bottom center */}
                    <div style={{
                        position: 'absolute', bottom: showBar ? 62 : 12, left: 0, right: 0,
                        textAlign: 'center', fontSize: 11, color: '#bbb', zIndex: 5,
                        transition: 'bottom 0.3s ease', pointerEvents: 'none',
                    }}>
                        {page}
                    </div>

                    {/* Sliding bottom bar */}
                    <div onClick={(e) => e.stopPropagation()} style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 15,
                        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px)',
                        borderTop: '1px solid rgba(0,0,0,0.06)',
                        padding: '10px 20px 22px',
                        transform: showBar ? 'translateY(0)' : 'translateY(100%)',
                        transition: 'transform 0.3s ease',
                    }}>
                        {/* Progress slider row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <button onClick={() => goPage(-1)} disabled={page <= 1}
                                style={{ background: 'none', border: 'none', fontSize: 18, color: page > 1 ? c.primary : '#ddd', cursor: 'pointer', padding: '2px 4px' }}>‹</button>
                            <div style={{ flex: 1, height: 3, borderRadius: 2, background: `${c.primary}18`, position: 'relative', overflow: 'hidden' }}>
                                <div style={{
                                    position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 2,
                                    width: `${totalPages > 1 ? ((page - 1) / (totalPages - 1)) * 100 : 100}%`,
                                    background: c.primary, transition: 'width 0.3s ease',
                                }} />
                            </div>
                            <button onClick={() => goPage(1)} disabled={page >= totalPages}
                                style={{ background: 'none', border: 'none', fontSize: 18, color: page < totalPages ? c.primary : '#ddd', cursor: 'pointer', padding: '2px 4px' }}>›</button>
                        </div>
                        {/* Bottom row: center page info, right function buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                            <span style={{ fontSize: 12, color: '#aaa' }}>{page} / {totalPages}</span>
                            <div style={{ position: 'absolute', right: 0, display: 'flex', gap: 16 }}>
                                <button onClick={() => setShowToc(true)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                    <span style={{ fontSize: 15, lineHeight: 1, color: '#666' }}>☰</span>
                                    <span style={{ fontSize: 9, color: '#aaa' }}>目录</span>
                                </button>
                                <button onClick={handleExport}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                    <span style={{ fontSize: 13, lineHeight: 1, color: '#666' }}>↓</span>
                                    <span style={{ fontSize: 9, color: '#aaa' }}>导出</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Settings overlay */}
            {showSettings && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setShowSettings(false)}>
                    <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 20, padding: '24px 22px', width: '100%', maxWidth: 340, boxShadow: '0 8px 40px rgba(0,0,0,0.15)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryDark, marginBottom: 18 }}>设置 Settings</div>
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>我的名字 My Name</label>
                        <input value={humanName} onChange={e => { setHumanName(e.target.value); localStorage.setItem('coread-human-name', e.target.value); }}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, marginBottom: 16, outline: 'none' }} />
                        <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 6 }}>AI的名字 AI Name</label>
                        <input value={aiName} onChange={e => { setAiName(e.target.value); localStorage.setItem('coread-ai-name', e.target.value); }}
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, marginBottom: 20, outline: 'none' }} />
                        <button onClick={() => setShowSettings(false)} style={{ width: '100%', padding: '10px 0', borderRadius: 14, background: c.primary, border: 'none', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>完成</button>
                    </div>
                </div>
            )}

            {/* Upload overlay */}
            {showUpload && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => { if (!uploading) setShowUpload(false); }}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 24,
                        padding: 24, width: '100%', maxWidth: 360, border: `1px solid ${c.primaryBorder}`, boxShadow: '0 12px 40px rgba(0,0,0,0.1)',
                    }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: c.primaryDark, marginBottom: 16 }}>上传书籍</div>

                        <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="书名"
                            style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 14, outline: 'none', marginBottom: 12, background: c.primaryBg, color: '#333' }} />

                        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.epub" onChange={handleFileSelect} style={{ display: 'none' }} />
                        <button onClick={() => fileInputRef.current?.click()} style={{
                            width: '100%', padding: '10px 14px', borderRadius: 12, border: `1px dashed ${c.primaryBorder}`,
                            background: c.primaryBg, fontSize: 13, color: c.primary, cursor: 'pointer', marginBottom: 8, textAlign: 'center',
                        }}>
                            {uploadFileName ? `已选: ${uploadFileName}` : '选择文件（PDF / TXT）'}
                        </button>

                        <div style={{ textAlign: 'center', fontSize: 11, color: '#ccc', margin: '4px 0 8px' }}>— 或者 —</div>

                        <textarea value={uploadText} onChange={e => { setUploadText(e.target.value); setPdfBase64(''); setUploadFileName(''); }}
                            placeholder="粘贴文本内容...（段落之间用空行分隔）"
                            style={{ width: '100%', minHeight: 100, padding: '10px 14px', borderRadius: 12, border: `1px solid ${c.primaryBorder}`, fontSize: 13, outline: 'none', resize: 'vertical', background: c.primaryBg, color: '#333', lineHeight: 1.5 }} />

                        <input ref={batchFileRef} type="file" accept=".epub" multiple onChange={handleBatchUpload} style={{ display: 'none' }} />
                        <button onClick={() => batchFileRef.current?.click()} disabled={uploading} style={{
                            width: '100%', padding: '10px 0', borderRadius: 14, border: `1px dashed ${c.primary}`,
                            background: `${c.primary}10`, fontSize: 13, color: c.primary, cursor: 'pointer', marginTop: 12, fontWeight: 600,
                        }}>
                            {uploading ? '批量上传中...' : '批量上传 epub'}
                        </button>

                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <button onClick={() => setShowUpload(false)} disabled={uploading}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: `1px solid ${c.primaryBorder}`, background: 'white', fontSize: 13, color: '#999', cursor: 'pointer' }}>取消</button>
                            <button onClick={handleUpload} disabled={uploading}
                                style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: 'none', background: c.primary, fontSize: 13, color: 'white', cursor: 'pointer', fontWeight: 600, opacity: uploading ? 0.6 : 1 }}>
                                {uploading ? '上传中...' : '添加到书架'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation */}
            {confirmDelete !== null && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={() => setConfirmDelete(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 20,
                        padding: 24, width: '100%', maxWidth: 300, textAlign: 'center', border: `1px solid ${c.primaryBorder}`,
                    }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 6 }}>确认删除？</div>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>书籍和所有批注都会被删除</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: `1px solid ${c.primaryBorder}`, background: 'white', fontSize: 13, color: '#999', cursor: 'pointer' }}>取消</button>
                            <button onClick={() => handleDeleteBook(confirmDelete)} style={{ flex: 1, padding: '10px 0', borderRadius: 14, border: 'none', background: '#e66', fontSize: 13, color: 'white', cursor: 'pointer', fontWeight: 600 }}>删除</button>
                        </div>
                    </div>
                </div>
            )}

            {/* TOC overlay */}
            {showToc && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)', zIndex: 30, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}
                    onClick={() => setShowToc(false)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 20,
                        padding: '16px 0', width: 'calc(100% - 40px)', maxWidth: 360, maxHeight: '60vh', overflow: 'auto',
                        border: `1px solid ${c.primaryBorder}`, boxShadow: '0 12px 40px rgba(0,0,0,0.1)',
                    }} className="no-scrollbar">
                        <div style={{ fontSize: 14, fontWeight: 700, color: c.primaryDark, padding: '0 20px 12px', borderBottom: `1px solid ${c.primaryBorder}` }}>目录</div>
                        {tocChapters.map((ch, i) => (
                            <button key={i} onClick={() => jumpToChapter(ch)} style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 20px', background: ch.page === page ? c.primaryBg : 'transparent',
                                border: 'none', borderBottom: `1px solid ${c.primaryBorder}22`, cursor: 'pointer', textAlign: 'left',
                            }}>
                                <span style={{ fontSize: 13, color: ch.page === page ? c.primary : '#444', fontWeight: ch.page === page ? 600 : 400, flex: 1, lineHeight: 1.4 }}>{ch.title}</span>
                                <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8, flexShrink: 0 }}>p.{ch.page}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudyApp;
