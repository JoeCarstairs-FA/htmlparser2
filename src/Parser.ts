import Tokenizer, { FileLocation } from "./Tokenizer";

const formTags = new Set([
    "input",
    "option",
    "optgroup",
    "select",
    "button",
    "datalist",
    "textarea",
]);

const pTag = new Set(["p"]);

const openImpliesClose: Record<string, Set<string>> = {
    tr: new Set(["tr", "th", "td"]),
    th: new Set(["th"]),
    td: new Set(["thead", "th", "td"]),
    body: new Set(["head", "link", "script"]),
    li: new Set(["li"]),
    p: pTag,
    h1: pTag,
    h2: pTag,
    h3: pTag,
    h4: pTag,
    h5: pTag,
    h6: pTag,
    select: formTags,
    input: formTags,
    output: formTags,
    button: formTags,
    datalist: formTags,
    textarea: formTags,
    option: new Set(["option"]),
    optgroup: new Set(["optgroup", "option"]),
    dd: new Set(["dt", "dd"]),
    dt: new Set(["dt", "dd"]),
    address: pTag,
    article: pTag,
    aside: pTag,
    blockquote: pTag,
    details: pTag,
    div: pTag,
    dl: pTag,
    fieldset: pTag,
    figcaption: pTag,
    figure: pTag,
    footer: pTag,
    form: pTag,
    header: pTag,
    hr: pTag,
    main: pTag,
    nav: pTag,
    ol: pTag,
    pre: pTag,
    section: pTag,
    table: pTag,
    ul: pTag,
    rt: new Set(["rt", "rp"]),
    rp: new Set(["rt", "rp"]),
    tbody: new Set(["thead", "tbody"]),
    tfoot: new Set(["thead", "tbody"]),
};

const voidElements = new Set([
    "area",
    "base",
    "basefont",
    "br",
    "col",
    "command",
    "embed",
    "frame",
    "hr",
    "img",
    "input",
    "isindex",
    "keygen",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
]);

const foreignContextElements = new Set(["math", "svg"]);

const htmlIntegrationElements = new Set([
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "annotation-xml",
    "foreignObject",
    "desc",
    "title",
]);

export interface ParserOptions {
    /**
     * Indicates whether special tags (`<script>`, `<style>`, and `<title>`) should get special treatment
     * and if "empty" tags (eg. `<br>`) can have children.  If `false`, the content of special tags
     * will be text only. For feeds and other XML content (documents that don't consist of HTML),
     * set this to `true`.
     *
     * @default false
     */
    xmlMode?: boolean;

    /**
     * Decode entities within the document.
     *
     * @default true
     */
    decodeEntities?: boolean;

    /**
     * If set to true, all tags will be lowercased.
     *
     * @default !xmlMode
     */
    lowerCaseTags?: boolean;

    /**
     * If set to `true`, all attribute names will be lowercased. This has noticeable impact on speed.
     *
     * @default !xmlMode
     */
    lowerCaseAttributeNames?: boolean;

    /**
     * If set to true, CDATA sections will be recognized as text even if the xmlMode option is not enabled.
     * NOTE: If xmlMode is set to `true` then CDATA sections will always be recognized as text.
     *
     * @default xmlMode
     */
    recognizeCDATA?: boolean;

    /**
     * If set to `true`, self-closing tags will trigger the onclosetag event even if xmlMode is not set to `true`.
     * NOTE: If xmlMode is set to `true` then self-closing tags will always be recognized.
     *
     * @default xmlMode
     */
    recognizeSelfClosing?: boolean;

    /**
     * Allows the default tokenizer to be overwritten.
     */
    Tokenizer?: typeof Tokenizer;
}

export interface Handler {
    onparserinit(parser: Parser): void;

    /**
     * Resets the handler back to starting state
     */
    onreset(): void;

    /**
     * Signals the handler that parsing is done
     */
    onend(): void;
    onerror(error: Error, where: FileLocation): void;
    onclosetag(name: string, where: FileLocation): void;
    onopentagname(name: string, where: FileLocation): void;
    /**
     *
     * @param name Name of the attribute
     * @param value Value of the attribute.
     * @param quote Quotes used around the attribute. `null` if the attribute has no quotes around the value, `undefined` if the attribute has no value.
     */
    onattribute(
        name: string,
        value: string,
        where: FileLocation,
        quote?: string | undefined | null
    ): void;
    onopentag(
        name: string,
        attribs: { [s: string]: string },
        where: FileLocation
    ): void;
    ontext(data: string, where: FileLocation): void;
    oncomment(data: string, where: FileLocation): void;
    oncdatastart(): void;
    oncdataend(where: FileLocation): void;
    oncommentend(where: FileLocation): void;
    onprocessinginstruction(
        name: string,
        data: string,
        where: FileLocation
    ): void;
    onerbexpression(data: string, where: FileLocation): void;
    onerbscriptlet(data: string, where: FileLocation): void;
}

const reNameEnd = /\s|\//;

export class Parser {
    /** The start index of the last event. */
    public startIndex = 0;
    /** The end index of the last event. */
    public endIndex: number | null = null;

    private tagname = "";
    private attribname = "";
    private attribvalue = "";
    private attribs: null | { [key: string]: string } = null;
    private stack: string[] = [];
    private readonly foreignContext: boolean[] = [];
    private readonly cbs: Partial<Handler>;
    private readonly options: ParserOptions;
    private readonly lowerCaseTagNames: boolean;
    private readonly lowerCaseAttributeNames: boolean;
    private readonly tokenizer: Tokenizer;

    constructor(cbs: Partial<Handler> | null, options: ParserOptions = {}) {
        this.options = options;
        this.cbs = cbs ?? {};
        this.lowerCaseTagNames = options.lowerCaseTags ?? !options.xmlMode;
        this.lowerCaseAttributeNames =
            options.lowerCaseAttributeNames ?? !options.xmlMode;
        this.tokenizer = new (options.Tokenizer ?? Tokenizer)(
            this.options,
            this
        );
        this.cbs.onparserinit?.(this);
    }

    private updatePosition(initialOffset: number) {
        if (this.endIndex === null) {
            if (this.tokenizer.sectionStart <= initialOffset) {
                this.startIndex = 0;
            } else {
                this.startIndex = this.tokenizer.sectionStart - initialOffset;
            }
        } else {
            this.startIndex = this.endIndex + 1;
        }
        this.endIndex = this.tokenizer.getAbsoluteIndex();
    }

    // Tokenizer event handlers
    ontext(data: string, where: FileLocation): void {
        this.updatePosition(1);
        (this.endIndex as number)--;
        this.cbs.ontext?.(data, where);
    }

    isVoidElement(name: string): boolean {
        return !this.options.xmlMode && voidElements.has(name);
    }

    onopentagname(name: string, where: FileLocation): void {
        if (this.lowerCaseTagNames) {
            name = name.toLowerCase();
        }
        this.tagname = name;
        if (
            !this.options.xmlMode &&
            Object.prototype.hasOwnProperty.call(openImpliesClose, name)
        ) {
            let el;
            while (
                this.stack.length > 0 &&
                openImpliesClose[name].has(
                    (el = this.stack[this.stack.length - 1])
                )
            ) {
                this.onclosetag(el, where);
            }
        }
        if (!this.isVoidElement(name)) {
            this.stack.push(name);
            if (foreignContextElements.has(name)) {
                this.foreignContext.push(true);
            } else if (htmlIntegrationElements.has(name)) {
                this.foreignContext.push(false);
            }
        }
        this.cbs.onopentagname?.(name, where);
        if (this.cbs.onopentag) this.attribs = {};
    }

    onopentagend(where: FileLocation): void {
        this.updatePosition(1);
        if (this.attribs) {
            this.cbs.onopentag?.(this.tagname, this.attribs, where);
            this.attribs = null;
        }
        if (this.cbs.onclosetag && this.isVoidElement(this.tagname)) {
            this.cbs.onclosetag(this.tagname, where);
        }
        this.tagname = "";
    }

    onclosetag(name: string, where: FileLocation): void {
        this.updatePosition(1);
        if (this.lowerCaseTagNames) {
            name = name.toLowerCase();
        }
        if (
            foreignContextElements.has(name) ||
            htmlIntegrationElements.has(name)
        ) {
            this.foreignContext.pop();
        }
        if (this.stack.length && !this.isVoidElement(name)) {
            let pos = this.stack.lastIndexOf(name);
            if (pos !== -1) {
                if (this.cbs.onclosetag) {
                    pos = this.stack.length - pos;
                    while (pos--) {
                        // We know the stack has sufficient elements.
                        this.cbs.onclosetag(this.stack.pop() as string, where);
                    }
                } else this.stack.length = pos;
            } else if (name === "p" && !this.options.xmlMode) {
                this.onopentagname(name, where);
                this.closeCurrentTag(where);
            }
        } else if (!this.options.xmlMode && (name === "br" || name === "p")) {
            this.onopentagname(name, where);
            this.closeCurrentTag(where);
        }
    }

    onselfclosingtag(where: FileLocation): void {
        if (
            this.options.xmlMode ||
            this.options.recognizeSelfClosing ||
            this.foreignContext[this.foreignContext.length - 1]
        ) {
            this.closeCurrentTag(where);
        } else {
            this.onopentagend(where);
        }
    }

    private closeCurrentTag(where: FileLocation) {
        const name = this.tagname;
        this.onopentagend(where);
        /*
         * Self-closing tags will be on the top of the stack
         * (cheaper check than in onclosetag)
         */
        if (this.stack[this.stack.length - 1] === name) {
            this.cbs.onclosetag?.(name, where);
            this.stack.pop();
        }
    }

    onattribname(name: string): void {
        if (this.lowerCaseAttributeNames) {
            name = name.toLowerCase();
        }
        this.attribname = name;
    }

    onattribdata(value: string): void {
        this.attribvalue += value;
    }

    onattribend(quote: string | undefined | null, where: FileLocation): void {
        this.cbs.onattribute?.(this.attribname, this.attribvalue, where, quote);
        if (
            this.attribs &&
            !Object.prototype.hasOwnProperty.call(this.attribs, this.attribname)
        ) {
            this.attribs[this.attribname] = this.attribvalue;
        }
        this.attribname = "";
        this.attribvalue = "";
    }

    private getInstructionName(value: string) {
        const idx = value.search(reNameEnd);
        let name = idx < 0 ? value : value.substr(0, idx);

        if (this.lowerCaseTagNames) {
            name = name.toLowerCase();
        }

        return name;
    }

    ondeclaration(value: string, where: FileLocation): void {
        if (this.cbs.onprocessinginstruction) {
            const name = this.getInstructionName(value);
            this.cbs.onprocessinginstruction(`!${name}`, `!${value}`, where);
        }
    }

    onprocessinginstruction(value: string, where: FileLocation): void {
        if (this.cbs.onprocessinginstruction) {
            const name = this.getInstructionName(value);
            this.cbs.onprocessinginstruction(`?${name}`, `?${value}`, where);
        }
    }

    oncomment(value: string, where: FileLocation): void {
        this.updatePosition(4);
        this.cbs.oncomment?.(value, where);
        this.cbs.oncommentend?.(where);
    }

    oncdata(value: string, where: FileLocation): void {
        this.updatePosition(1);
        if (this.options.xmlMode || this.options.recognizeCDATA) {
            this.cbs.oncdatastart?.();
            this.cbs.ontext?.(value, where);
            this.cbs.oncdataend?.(where);
        } else {
            this.oncomment(`[CDATA[${value}]]`, where);
        }
    }

    onerror(err: Error, where: FileLocation): void {
        this.cbs.onerror?.(err, where);
    }

    onend(where: FileLocation): void {
        if (this.cbs.onclosetag) {
            for (
                let i = this.stack.length;
                i > 0;
                this.cbs.onclosetag(this.stack[--i], where)
            );
        }
        this.cbs.onend?.();
    }

    onerbexpression(data: string, where: FileLocation): void {
        this.cbs.onerbexpression?.(data, where);
    }

    onerbscriptlet(data: string, where: FileLocation): void {
        this.cbs.onerbscriptlet?.(data, where);
    }

    /**
     * Resets the parser to a blank state, ready to parse a new HTML document
     */
    public reset(): void {
        this.cbs.onreset?.();
        this.tokenizer.reset();
        this.tagname = "";
        this.attribname = "";
        this.attribs = null;
        this.stack = [];
        this.cbs.onparserinit?.(this);
    }

    /**
     * Resets the parser, then parses a complete document and
     * pushes it to the handler.
     *
     * @param data Document to parse.
     */
    public parseComplete(data: string): void {
        this.reset();
        this.end(data);
    }

    /**
     * Parses a chunk of data and calls the corresponding callbacks.
     *
     * @param chunk Chunk to parse.
     */
    public write(chunk: string): void {
        this.tokenizer.write(chunk);
    }

    /**
     * Parses the end of the buffer and clears the stack, calls onend.
     *
     * @param chunk Optional final chunk to parse.
     */
    public end(chunk?: string): void {
        this.tokenizer.end(chunk);
    }

    /**
     * Pauses parsing. The parser won't emit events until `resume` is called.
     */
    public pause(): void {
        this.tokenizer.pause();
    }

    /**
     * Resumes parsing after `pause` was called.
     */
    public resume(): void {
        this.tokenizer.resume();
    }

    /**
     * Alias of `write`, for backwards compatibility.
     *
     * @param chunk Chunk to parse.
     * @deprecated
     */
    public parseChunk(chunk: string): void {
        this.write(chunk);
    }
    /**
     * Alias of `end`, for backwards compatibility.
     *
     * @param chunk Optional final chunk to parse.
     * @deprecated
     */
    public done(chunk?: string): void {
        this.end(chunk);
    }
}
