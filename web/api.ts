const BASE = window.location.origin;

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  fetchBooks: () => request('/v1/books'),
  fetchBookDetail: (bookId: number, page = 1, perPage = 10) =>
    request(`/v1/books/${bookId}?page=${page}&per_page=${perPage}`),
  fetchBookSlice: (bookId: number, start = 0, count = 30) =>
    request(`/v1/books/${bookId}/slice?start=${start}&count=${count}`),
  addBookComment: (bookId: number, data: any) =>
    request(`/v1/books/${bookId}/comment`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBookComment: (commentId: number) =>
    request(`/v1/books/comment/${commentId}`, { method: 'DELETE' }),
  updateBookProgress: (bookId: number, page: number) =>
    request(`/v1/books/${bookId}/progress`, { method: 'PATCH', body: JSON.stringify({ page }) }),
  createBook: (data: any) =>
    request('/v1/books', { method: 'POST', body: JSON.stringify(data) }),
  deleteBook: (bookId: number) =>
    request(`/v1/books/${bookId}`, { method: 'DELETE' }),
  fetchBookToc: (bookId: number) =>
    request(`/v1/books/${bookId}/toc`),
  exportBook: async (bookId: number, format = 'epub') => {
    const res = await fetch(`${BASE}/v1/books/${bookId}/export?format=${format}`);
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  imageUrl: (bookId: number, filename: string) =>
    `${BASE}/v1/book-images/${bookId}/${filename}`,
  wishlistUrl: () => `${BASE}/v1/reading-wishlist`,
};
