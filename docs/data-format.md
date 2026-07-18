To address the need for a highly optimized, human-readable data format specifically tailored for Q&A platforms, I have designed **QDF (Question Data Format)**.
QDF is a minimalist, line-based plain-text format that strips away the punctuation overhead of JSON, avoids the parsing ambiguity of YAML, and supports streaming natively. It treats strings as first-class citizens, making it ideal for essays, code blocks, and multiple-choice questions.
## 1. Language Specification
QDF files are structured as a stream of **Records** (objects) separated by block dividers (---).
### Core Rules
 * **Encoding:** UTF-8.
 * **Data Types:** To guarantee deterministic parsing and avoid the infamous "YAML Norway Problem" (where "NO" evaluates to a boolean), **all values in QDF are natively parsed as strings**. Type casting (to integers or booleans) is delegated to the application's schema.
 * **Key-Value Pairs:** Defined by Key: Value. The key must be alphanumeric (plus underscores). The value is the literal rest of the line. Leading and trailing whitespace on the value is trimmed. No quotes are needed.
 * **Comments:** Any line starting with # (after optional whitespace) is a comment and is ignored. Inline comments are not supported to allow # safely inside text (e.g., Language: C#).
 * **Optional Fields:** If a key is missing, it is evaluated as null/undefined in the resulting HashMap.
 * **Record Separator:** --- on a line by itself starts a new root object in the array of records. This allows O(1) memory streaming of massive question banks.
### Nested Structures (Indentation)
Hierarchy is established strictly by **2 spaces** per indentation level. Tabs are forbidden.
 * **Arrays:** Indented lines starting with - .
 * **Objects:** Indented keys.
 * **Multiline Strings (Essays/Code):** Indented blocks following a key ending in : >. The parser captures all subsequent lines at a deeper indentation level, preserving internal line breaks and removing the base indentation.
## 2. Examples
### A. Simple Flashcard
```qdf
Type: Flashcard
Front: What is the mitochondria?
Back: The powerhouse of the cell.
Tags:
- Biology
- Cell Anatomy

```
### B. Multiple-Choice Question (with Nested Objects)
```qdf
Type: MultipleChoice
ID: bio_102
Question: Which of the following are RNA nucleobases?
Options:
- Text: Adenine, Thymine, Cytosine, Guanine
  IsCorrect: false
- Text: Adenine, Uracil, Cytosine, Guanine
  IsCorrect: true
Explanation: >
  RNA replaces the Thymine found in DNA with Uracil.
  Both pair with Adenine.

```
### C. Large Document Stream (Streaming Multiple Records)
```qdf
# Document Header / Metadata
Title: Final Exam 2026
Author: Prof. Smith
PassingScore: 75
---
Type: Essay
ID: q1
Prompt: >
  Discuss the socioeconomic factors leading 
  to the fall of the Roman Empire.
WordCountLimit: 1500
---
Type: ShortAnswer
ID: q2
Prompt: What year did the Berlin Wall fall?
AcceptableAnswers:
- 1989
- Nineteen Eighty-Nine

```
## 3. EBNF Grammar
```ebnf
document       = { record_block } ;
record_block   = [ record ], { "\n", separator, "\n", [ record ] } ;
separator      = "---" ;

record         = { field | comment | blank_line } ;
field          = scalar_field | array_field | object_field | multiline_field ;

scalar_field   = indent, key, ": ", string, "\n" ;
array_field    = indent, key, ":\n", { array_item } ;
object_field   = indent, key, ":\n", { field } ;
multiline_field= indent, key, ": >\n", { multiline_str } ;

array_item     = indent, "- ", ( string | nested_obj_start ), "\n" ;
nested_obj_start= key, ": ", string ; (* subsequent lines at same indent form the object *)

key            = [a-zA-Z0-9_]+ ;
string         = ? any valid UTF-8 characters except newline ? ;
multiline_str  = indent, "  ", string, "\n" ;
comment        = indent, "#", string, "\n" ;
blank_line     = indent, "\n" ;
indent         = { "  " } ; (* Strictly pairs of spaces *)

```
## 4. Parsing Algorithm (O(N) Single-Pass)
Because QDF uses explicit line-start markers and strict indentation, parsing is an extremely fast, deterministic state machine.
**State Variables:**
 * records: List of root objects.
 * current_object: The active HashMap.
 * stack: Array of (indent_level, reference_to_object_or_array).
 * multiline_buffer: Accumulator for text blocks.
**Line-by-Line Execution:**
 1. **Read line:** Trim trailing whitespace.
 2. **Check Separator:** If line is ---, push current_object to records, reset current_object to empty, reset stack. Continue.
 3. **Check Comment/Blank:** If line is empty or matches ^\s*#, skip.
 4. **Determine Indent:** Count leading spaces. Let this be N.
 5. **Adjust Stack:** While N <= stack.top().indent_level, pop the stack.
 6. **Evaluate Line Content (ignoring indent):**
   * *Match ^([a-zA-Z0-9_]+): >$ (Multiline):* Next lines where indent > N are appended to multiline_buffer (stripping N + 2 spaces). Assign buffer to current_object[key].
   * *Match ^([a-zA-Z0-9_]+):$ (Object/Array Start):* Create an empty placeholder. Push to stack with indent N.
   * *Match ^([a-zA-Z0-9_]+): (.*)$ (Scalar):* Assign current_object[key] = value.
   * *Match ^- (.*)$ (Array Item):*
     * If the target on stack is not an array, convert it to an array.
     * If (.*) matches a key-value pair (Key: Value), create a new object, add to array, and push to stack (to capture sibling properties of this array object).
     * Otherwise, append the string to the array.
### Error Handling
 * **Indentation Error:** If N is not an even number, or if an array item's indent does not match the parent's expected child indent, throw a ParseError(line_num).
 * **Duplicate Keys:** Overwrite the previous key, or optionally throw an error based on strict-mode implementation.
## 5. Serialization Algorithm
Writing QDF is highly efficient and requires almost no string escaping.
**Function serialize(data, indent_level = 0):**
 1. **For Arrays:** Iterate items. Print indent + "- " followed by the value. If the value is an object, print the first key-value on the same line as the dash, and subsequent keys on new lines at the same indent_level + 2.
 2. **For Objects:** Iterate keys.
 3. **For Strings (Values):**
   * If the string contains \n: Print indent + key + ": >\n". Split the string by \n and print each line prefixed with indent + "  ".
   * If the string is single-line: Print indent + key + ": " + value.
 4. **For Records:** At the root level, if the data is an array of objects, run the serializer on each object and inject \n---\n between them.
## 6. Implementation Recommendations
 * **Streaming/Lazy Loading:** For systems importing 100,000+ questions, implement an iterator that yields a HashMap every time it hits ---. This guarantees a memory footprint of just one question at a time (O(1) memory).
 * **Type Coercion:** Implement the parser in two layers. The base layer outputs purely Map<String, Any>. The application layer should apply a schema (e.g., Pydantic in Python, Zod in TypeScript) to safely cast strings like "true" to booleans or "42" to integers.
 * **Zero-Copy Parsing (C/Rust):** Because QDF strings do not require unescaping \" or \n (unlike JSON), parsers in systems programming languages can use string views/slices directly referencing the memory-mapped file buffer, resulting in blazingly fast read speeds.
## 7. Format Comparison
| Format | Readability | File Size | Parser Speed | Multiline Text | Array of Objects | Verdict for Q&A |
|---|---|---|---|---|---|---|
| **QDF** | Excellent | Minimal | Very Fast (Single pass) | Native, no quotes | Clean | **Perfect.** Designed for text-heavy structures. |
| **JSON** | Poor (Syntax heavy) | Large (Quotes, braces) | Fast | Escaped \n nightmare | Clean but verbose | Too hard to hand-write essays or code. |
| **YAML** | Good | Medium | Slow (Complex spec) | Multiple types (>, |) | Cluttered | "Norway problem" risks; over-engineered for Q&A. |
| **TOML** | Good (Config) | Medium | Fast | Triple quotes """ | Verbose [[array]] | Great for configs, terrible for deep questions/essays. |
| **INI** | Good | Small | Very Fast | Non-standard/Hacks | Not supported | Cannot handle question options or nesting natively. |
| **CSV** | Poor | Minimal | Very Fast | Breaks on internal commas | Impossible | Useless for structured/hierarchical text data. |
| **Markdown** | Excellent | Minimal | Very Slow (Regex soup) | Native | Implicit only | Beautiful to read, but extracting strict key-values is error-prone. |
### Why QDF Wins
If a user writes a 3-paragraph essay explanation containing quotes ", commas ,, and code snippets, JSON requires them to format it as a single unreadable line of \n and \". YAML might try to auto-cast unquoted words to dates or booleans. QDF's Key: > block strictly isolates the text, treats it as a literal string, requires zero escaping, and streams perfectly into a database.
