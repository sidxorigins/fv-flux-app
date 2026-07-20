export function apiOk<T>(data: T, init?: { status?: number }): Response {
  return Response.json(data, { status: init?.status ?? 200 });
}

export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status });
}
