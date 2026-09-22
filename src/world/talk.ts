export interface Named {
  id: string;
  name: string;
}

export interface ParsedTalk {
  audience: "town" | "direct";
  ids: string[];
  body: string;
  suggest: boolean;
  error: string | null;
}

export function parseVisitorTalk(raw: string, people: Named[]): ParsedTalk {
  let text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { audience: "town", ids: [], body: "", suggest: false, error: "Say something." };
  let suggest = false;
  if (/^suggest\b/i.test(text)) {
    suggest = true;
    text = text.replace(/^suggest\b/i, "").trim();
  }
  const byName = new Map(people.map((person) => [person.name.toLowerCase(), person]));

  if (/^@all\b/i.test(text)) {
    const body = text.replace(/^@all\b/i, "").trim();
    if (!body) return { audience: "town", ids: [], body: "", suggest, error: "Add a few words after @all." };
    return { audience: "town", ids: [], body, suggest, error: null };
  }

  if (text.startsWith("@@")) {
    const rest = text.slice(2).trim();
    const words = rest.split(" ");
    const ids: string[] = [];
    let index = 0;
    while (index < words.length && ids.length < 3) {
      const found = byName.get(words[index]?.toLowerCase() ?? "");
      if (!found) break;
      ids.push(found.id);
      index += 1;
    }
    const body = words.slice(index).join(" ").trim();
    if (ids.length === 0) return { audience: "direct", ids: [], body, suggest, error: "Name up to three people after @@." };
    if (!body) return { audience: "direct", ids, body: "", suggest, error: "Add what you want to say." };
    return { audience: "direct", ids, body, suggest, error: null };
  }

  if (text.startsWith("@")) {
    const rest = text.slice(1).trim();
    const words = rest.split(" ");
    const found = byName.get(words[0]?.toLowerCase() ?? "");
    if (!found) return { audience: "direct", ids: [], body: rest, suggest, error: "That name is not in the town." };
    const body = words.slice(1).join(" ").trim();
    if (!body) return { audience: "direct", ids: [found.id], body: "", suggest, error: "Add what you want to say." };
    return { audience: "direct", ids: [found.id], body, suggest, error: null };
  }

  return { audience: "town", ids: [], body: text, suggest, error: "Start with @all, @Name, or @@ Name Name Name." };
}
