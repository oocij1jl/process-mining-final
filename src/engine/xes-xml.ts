// The XES importer uses this bounded XML tokenizer in both Node and the browser.
// It has no DTD grammar, resource resolver, or DOM insertion path.
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const XINCLUDE = 'http://www.w3.org/2001/XInclude';
const nameStart = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const namePart = new RegExp(`[${nameStart}][${nameStart}0-9.\\-\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*`, 'uy');
const whitespace = /[ \t\n\r]+/y;
const nonWhitespace = /[^ \t\n\r]/;
const declaration = /^<\?xml[ \t\n\r]+version[ \t\n\r]*=[ \t\n\r]*(['"])(1\.[01])\1(?:[ \t\n\r]+encoding[ \t\n\r]*=[ \t\n\r]*(['"])([A-Za-z][A-Za-z0-9._-]*)\3)?(?:[ \t\n\r]+standalone[ \t\n\r]*=[ \t\n\r]*(['"])(yes|no)\5)?[ \t\n\r]*\?>/;
const entities = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['apos', "'"], ['quot', '"']]);

export class XesXmlError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface Element {
  name: string;
  namespace: string;
  attrs: ReadonlyMap<string, string>;
}

interface XmlHandlers {
  open(element: Element): void;
  close(): void;
  text(text: string): void;
}

function malformed(message: string): never {
  throw new XesXmlError('xes_malformed_xml', message);
}

function decodeReferences(text: string, xml11: boolean): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^&;]*);|&/g, (_, reference: string | undefined) => {
    const predefined = reference ? entities.get(reference) : undefined;
    if (predefined !== undefined) return predefined;
    const code = /^#x[0-9a-fA-F]+$/.test(reference ?? '') ? Number.parseInt(reference!.slice(2), 16)
      : /^#[0-9]+$/.test(reference ?? '') ? Number(reference!.slice(1)) : NaN;
    if (!(code > 0 && (xml11 || code === 9 || code === 10 || code === 13 || code >= 32) &&
      code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) && code !== 0xFFFE && code !== 0xFFFF)) {
      malformed('Invalid XML character or entity reference.');
    }
    return String.fromCodePoint(code);
  });
}

export function parseXesXml(source: string, handlers: XmlHandlers): void {
  const header = declaration.exec(source);
  if (header?.[4] && header[4].toLowerCase() !== 'utf-8') {
    throw new XesXmlError('xes_invalid_encoding', 'XES must use UTF-8 encoding.');
  }
  const xml11 = header?.[2] === '1.1';
  const invalidLiteral = xml11 ? /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]/
    : /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/;
  if (invalidLiteral.test(source)) malformed('Invalid literal XML character.');
  const xml = xml11 ? source.replace(/\r\n|\r\u0085|[\r\u0085\u2028]/g, '\n') : source.replace(/\r\n?/g, '\n');
  let position = header ? declaration.exec(xml)![0].length : 0;
  let elementCount = 0;
  let seenRoot = false;
  const defaultNamespaces = new Map([['xml', XML]]);
  const stack: { qualifiedName: string; namespaces: ReadonlyMap<string, string> }[] = [];

  function skipWhitespace() {
    whitespace.lastIndex = position;
    if (whitespace.test(xml)) position = whitespace.lastIndex;
  }

  function readName(qualified = true): string {
    namePart.lastIndex = position;
    if (!namePart.test(xml)) malformed('Expected an XML name.');
    const start = position;
    position = namePart.lastIndex;
    while (xml[position] === ':') {
      namePart.lastIndex = position + 1;
      if (!namePart.test(xml) || (qualified && xml.slice(start, position).includes(':'))) malformed('Invalid qualified XML name.');
      position = namePart.lastIndex;
    }
    return xml.slice(start, position);
  }

  function openElement() {
    const qualifiedName = readName();
    const attrs = new Map<string, string>();
    let empty = false;
    for (;;) {
      const before = position;
      skipWhitespace();
      if (xml[position] === '>') {
        position++;
        break;
      }
      if (xml.startsWith('/>', position)) {
        position += 2;
        empty = true;
        break;
      }
      if (before === position) malformed('Expected whitespace before an XML attribute.');
      const key = readName();
      if (attrs.has(key)) malformed('An XML attribute was repeated.');
      skipWhitespace();
      if (xml[position++] !== '=') malformed('Expected an XML attribute value.');
      skipWhitespace();
      const quote = xml[position++];
      if (quote !== '"' && quote !== "'") malformed('XML attribute values must be quoted.');
      const end = xml.indexOf(quote, position);
      if (end === -1) malformed('Unclosed XML attribute.');
      const raw = xml.slice(position, end);
      if (raw.includes('<')) malformed('Unexpected markup in an XML attribute.');
      attrs.set(key, decodeReferences(raw.replace(/[\t\n\r]/g, ' '), xml11));
      position = end + 1;
    }

    if (++elementCount > 500_000 || stack.length >= 32) {
      throw new XesXmlError('xes_limit_exceeded', 'XES is limited to 500,000 XML elements and depth 32.');
    }
    if (!stack.length) {
      if (seenRoot) malformed('Expected one XML root element.');
      seenRoot = true;
    }

    const inherited = stack.at(-1)?.namespaces ?? defaultNamespaces;
    let declarations: Map<string, string> | undefined;
    for (const [key, value] of attrs) {
      if (key !== 'xmlns' && !key.startsWith('xmlns:')) continue;
      const prefix = key === 'xmlns' ? '' : key.slice(6);
      if (prefix === 'xmlns' || value === XMLNS || (prefix === 'xml') !== (value === XML) ||
        (prefix && !value && !xml11)) malformed('Invalid XML namespace declaration.');
      (declarations ??= new Map(inherited)).set(prefix, value);
    }
    const namespaces = declarations ?? inherited;
    function expand(name: string, attribute: boolean): [string, string] {
      const split = name.indexOf(':');
      if (split === -1) return [attribute ? '' : namespaces.get('') ?? '', name];
      const namespace = namespaces.get(name.slice(0, split));
      if (!namespace) malformed('An XML prefix has no namespace declaration.');
      return [namespace, name.slice(split + 1)];
    }
    const [namespace, name] = expand(qualifiedName, false);
    if (namespace === XINCLUDE) throw new XesXmlError('xes_unsafe_xml', 'XInclude is not allowed in XES.');
    const expanded = new Set<string>();
    for (const key of attrs.keys()) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      const name = JSON.stringify(expand(key, true));
      if (expanded.has(name)) malformed('An XML attribute was repeated through a namespace alias.');
      expanded.add(name);
    }
    handlers.open({ name, namespace, attrs });
    if (empty) handlers.close();
    else stack.push({ qualifiedName, namespaces });
  }

  while (position < xml.length) {
    if (xml[position] !== '<') {
      const next = xml.indexOf('<', position);
      const end = next === -1 ? xml.length : next;
      const raw = xml.slice(position, end);
      if (stack.length) {
        if (raw.includes(']]>')) malformed('Unexpected CDATA close.');
        handlers.text(decodeReferences(raw, xml11));
      } else if (nonWhitespace.test(raw)) malformed('Unexpected content outside the root.');
      position = end;
    } else if (xml.startsWith('<!--', position)) {
      const end = xml.indexOf('--', position + 4);
      if (end === -1 || xml.slice(end, end + 3) !== '-->') malformed('Invalid or unclosed XML comment.');
      position = end + 3;
    } else if (xml.startsWith('<?', position)) {
      position += 2;
      const target = readName(false).toLowerCase();
      if (target === 'xml-stylesheet') throw new XesXmlError('xes_unsafe_xml', 'XML stylesheets are not allowed in XES.');
      if (target === 'xml') malformed('Invalid or misplaced XML declaration.');
      const body = position;
      skipWhitespace();
      if (body === position && !xml.startsWith('?>', position)) malformed('Invalid XML processing instruction.');
      const end = xml.indexOf('?>', position);
      if (end === -1) malformed('Unclosed XML processing instruction.');
      position = end + 2;
    } else if (xml.startsWith('<![CDATA[', position)) {
      const end = xml.indexOf(']]>', position + 9);
      if (!stack.length || end === -1) malformed('Invalid or unclosed XML CDATA.');
      handlers.text(xml.slice(position + 9, end));
      position = end + 3;
    } else if (/^<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml.slice(position, position + 24))) {
      throw new XesXmlError('xes_unsafe_xml', 'DTDs and custom entity declarations are not allowed in XES.');
    } else if (xml.startsWith('</', position)) {
      position += 2;
      const name = readName();
      skipWhitespace();
      if (xml[position++] !== '>' || stack.at(-1)?.qualifiedName !== name) malformed('Mismatched XML closing element.');
      handlers.close();
      stack.pop();
    } else {
      position++;
      openElement();
    }
  }
  if (!seenRoot || stack.length) malformed('Expected a complete XML document.');
}
