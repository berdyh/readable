## Project Plan: Personalized AI Paper Summarizer and Tutor

### Overview

This project aims to build a web application that helps users read and understand research papers (initially focusing on arXiv papers) with the assistance of AI. The app will fetch a paper by its arXiv ID and generate a **concise, plain-language summary** of the paper’s key points, including explanations of important figures, graphs, and charts. Uniquely, the summary and Q&A will be **personalized** to the user’s existing knowledge: the system will leverage the user’s own knowledge profile (via Kontext.dev) to tailor explanations and avoid redundant detail. The user can interactively ask follow-up questions through a chat interface, or dive deeper into parts of the summary. The tool will dynamically identify prerequisite concepts for each section of the paper and either explain them or ask the user if they’re familiar, updating the user’s knowledge profile accordingly. The end goal is to make complex academic papers more accessible by presenting information at the right level for each user.

### Key Features and Goals
- **ArXiv Paper Ingestion**: Allow the user to input an arXiv ID (or URL) of a paper. The app will retrieve the paper’s content (title, abstract, and full text or PDF) and key metadata. We will use arXiv’s public data (and possibly PDF parsing) to get the abstract, sections (like table of contents or headings), and figures for analysis.
- **Multi-Pass Summarization**: Automatically generate a clear summary of the paper’s main contributions and findings. The summary should follow a “multiple passes” reading strategy inspired by best practices (e.g. first overview the title/abstract and figures, then delve deeper) – presenting the **high-level idea first**, then important details and results[https://news.ycombinator.com/item?id=45292648#:~:text=Shameless%20plug%20but%20I%20made,arXiv.org%20papers%20questions [1]][https://news.ycombinator.com/item?id=45292648#:~:text=I%20built%20it%20because%20it,it%20and%20give%20a%20prompt [2]]. It should highlight the answers to questions like: ''What problem does this paper address? What are the key methods or approaches? What are the main results? Why do they matter?'' The summary will also include explanations of important **figures, graphs, or tables** (e.g. summarizing what a chart shows and why it’s significant). All essential content will be visible (no hidden sections that require extra clicks), so the user gets a comprehensive but digestible overview in one go.
- **Personalized Context via Kontext.dev**: Integrate with **Kontext.dev** to adjust the summary and explanations to the user’s background. Users can optionally connect their data (e.g. authorize their Gmail or other sources through Kontext) to create a **persona** or profile of their knowledge. Kontext will extract structured facts about the user’s context and knowledge from those sources[https://docs.kontext.dev/documentation/welcome#:~:text=Kontext%20is%20the%20context%20layer,ensure%20full%20auditability%20and%20security [3]][https://docs.kontext.dev/documentation/welcome#:~:text=,enforces%20privacy%20when%20building%20context [4]]. For example, if the user’s emails or documents indicate they are a machine learning expert but not familiar with, say, quantum physics, the summary can presume ML knowledge but should carefully explain any quantum physics concepts. The app will use Kontext’s API (e.g. kontext.profile.getProfile) on each AI request to retrieve a **personalized context (systemPrompt)** for the LLM, ensuring outputs are tailored to the user’s known facts.
- **Interactive Prerequisite Q&A**: The system will dynamically handle prerequisite knowledge gaps. For each major topic or technical term in the paper, it will determine if the user likely knows it (by checking the Kontext profile or prior interactions). If the user **does not** have that prerequisite, the system can either:
    - Prompt the user with a quick question like ''“Are you familiar with [Concept X]?”'' at the moment it becomes relevant.
    - If the user says **yes**, we record that knowledge (and possibly update Kontext) and proceed without a redundant explanation. If **no**, the system will provide a brief, focused explanation of that concept before continuing. This way, the summary or explanation of the paper is augmented only as needed, and the user isn’t overwhelmed upfront with a barrage of questions or extraneous info. Each new piece of knowledge the user learns can be **added to their Kontext profile** dynamically (so the app remembers that the user now knows Concept X for future sessions).
- **Question-Answer Chat Widget**: After (or during) the summary, the user can ask questions about any part of the paper via a chat interface. They might click or highlight a portion of the summary (or even a section of the original paper text) and ask for more detail, clarification, or related information. The chat widget will provide answers using the paper’s content and the user’s context. It will reference specific sections or page numbers of the paper when relevant (e.g. “As shown in ''Figure 2 (page 5)'', …”) and those references will be clickable to scroll the paper viewer[https://news.ycombinator.com/item?id=45292648#:~:text=I%20built%20it%20because%20it,it%20and%20give%20a%20prompt [2]]. The Q&A will also utilize the user’s knowledge profile to tailor explanations. For example, if a question involves a concept not explained yet, the assistant might ask or explain it as per the user’s profile.
- **Modern Minimalist UI**: Design the interface to be clean and minimalistic, focusing on content. The interaction flow will be: **Home page** with input fields, then an **Analysis view** with the summary and Q&A. We want a look inspired by modern tools like Notion or AppFlowy – a neat two-pane layout or a single document-style page. After the user enters the paper ID (and optionally connects their persona), the paper’s PDF or content might briefly show (for context), then transition with a nice animation to a “Analyzing paper…” loading screen (perhaps using a subtle loading animation like a spinner or progress pattern). Once ready, the summary appears in a well-formatted way: possibly as a scrollable page of text broken into sections, with headings, bullet points for main findings, and inline images or figure thumbnails where applicable. The design should support a pop-up or side panel for the chat Q&A – for example, a chat icon or button that opens the ChatWidget as an overlay, similar to how Notion or AppFlowy might allow opening a contextual help or comment thread. Overall, the UI should feel intuitive and not cluttered, using a consistent color scheme and typography (we can take cues from AppFlowy’s simplicity or Notion’s clear layout).



### Tech Stack and Components

- **Next.js 13+ (React)**: We will use Next.js for the web application front-end and back-end. Next provides a React framework for building the UI and API routes for server-side logic. We can start with a standard **TypeScript Next.js** project (using create-next-app defaults) unless specific custom setup is needed. Using the default configuration is fine to begin with; we’ll configure additional settings as required (for example, we might adjust next.config.js to allow loading PDF files or cross-domain assets as needed).
- **OpenAI GPT-4 (or Gemini API)**: For the AI summarization and Q&A, we plan to use OpenAI’s models (like GPT-4 or GPT-3.5-turbo) via their API. These models will take the paper content (or relevant extracts) plus the Kontext-based personalization prompt to generate summaries and answers. If available, we will also support **Google’s Gemini** model as an alternative (the asXiv project integrated Gemini via Google’s AI Studio[https://github.com/montanaflynn/asxiv#:~:text=,Get%20one%20here [5]][https://github.com/montanaflynn/asxiv#:~:text=GEMINI\_MODEL%3Dgemini [6]]). We can make the model choice configurable (e.g., via environment variable or user setting). For development, focusing on OpenAI is simplest, but keeping the Gemini integration from asXiv (with an API key) as an option is a bonus.
- **PDF Processing**: We’ll use **PDF.js** (Mozilla’s PDF library) for rendering and maybe parsing PDFs[https://github.com/montanaflynn/asxiv#:~:text=,for%20the%20amazing%20React%20framework [7]]. The Next.js app will include a PDF viewer component (similar to asXiv’s pages/pdf/[...arxivId].tsx) which uses PDF.js to display the paper within the app. This allows users to see the original PDF pages if needed. For extracting text content from the PDF (to feed into the LLM), we have a couple of options:
- **Client-side**: Use PDF.js in the browser to get text snippets (e.g., extract text of the abstract, section headings, and maybe figure captions).
- **Server-side**: Use a Node PDF parsing library (or even PDF.js in a Node canvas environment) in the API route to extract the necessary text from the PDF. This might be needed to generate the summary without sending the entire PDF to the client first. We may also utilize arXiv’s API: arXiv provides an API for paper metadata (title, authors, abstract, etc.), which we can fetch by arXiv ID to at least get the abstract and title quickly.
- **ArXiv HTML**: Another approach is to use an HTML version of the paper if available (for example, arXiv has a format through a converter like ar5iv that produces HTML from LaTeX). This could simplify extracting text and figures, but it may be complex to integrate initially. For MVP, focusing on the PDF (which we know we can get) is acceptable.
- **Kontext.dev Integration**: On the front-end, we will include a **“Connect with Kontext”** option for the user. This likely involves an OAuth flow where the user grants access to data sources (e.g., Gmail). Kontext’s documentation suggests using their SDK or a pre-built React component (KontextConnectButton)[https://docs.kontext.dev/examples/react#:~:text=React%20, [8]] to handle the connection flow. Once connected, we obtain a stable userId or token for that user. We’ll store this in the session (e.g., in a cookie or local storage, and also send to our backend for API calls). On the backend, we use the Kontext API key (securely stored in env) to call kontext.profile.getProfile({ userId, task, userQuery }). For example:
    - For the summarization request, task might be something like "summarize\_research\_paper" (we’ll define a task context) and we pass no userQuery (since it’s a general summary task). Kontext will return a systemPrompt that encapsulates relevant facts about the user (e.g. education, expertise, interests gleaned from their data) which we then prepend to the LLM prompt.
    - For Q&A requests, task might be "qa\_research\_paper" and we can include the actual user question as userQuery to get any extra relevant personal context. The returned context might include facts like “User worked on [related topic] before” or “User likely unfamiliar with [jargon]” which helps the model answer appropriately.
    - We will also use Kontext to **update the user’s profile** over time. If the user answers that they know or don’t know a prerequisite concept, we can use an API call (perhaps something like kontext.profile.addFact if available) to record that information (e.g. “User knows: Fourier Transform”). This ensures the profile stays up-to-date. (If direct API for adding facts isn’t available, we might manage a custom list of “known concepts” in our own storage and feed that into the prompt as well.)
- **State & Data Management**: We might not need a full database initially. The paper content can be fetched on the fly from arXiv, and user knowledge is stored via Kontext. User session data (like their Kontext userId and perhaps preferences) can be kept client-side or in a lightweight session store. We should however plan for caching frequently accessed data:
    - Caching the paper’s extracted text or AI embeddings (if we use any) so we don’t re-fetch or re-parse the PDF repeatedly.
    - Caching the summary results for a given paper + user, possibly in memory or local storage, so if the user refreshes or revisits, they don’t have to wait for re-analysis (unless the user requests an updated summary).
    - We might use browser local storage or IndexDB for caching the summary or user’s last read papers, just for convenience.
- **Analytics (PostHog)**: Integrate **PostHog** for product analytics to track usage (this is optional but desired). We can include the PostHog snippet or use their JavaScript/Node library to capture events like “PaperAnalyzed”, “PersonaConnected”, “QuestionAsked”, etc. This will help in understanding feature usage and user flow. (PostHog can be easily integrated by adding their tracking code in Next.js – for example, in \_app.tsx or as a script tag – or via an MCP tool during development for convenience.)



### System Architecture & Workflow

**Overall flow**: 
1. **Home Page** (pages/index.tsx): The user enters an arXiv ID (or a URL). They are also presented with an optional **“Personalize with Kontext”** toggle or button. If they choose to personalize, they go through the Kontext connection: 
    - We show a “Connect your data for personalization” (with icons for Gmail, etc. as supported by Kontext). The Kontext SDK handles authentication; once done, we get a userId and perhaps a Persona object. We’ll indicate on the UI that personalization is active (maybe show their connected sources status). 
    - If the user skips personalization, we proceed with a generic profile (we can assume minimal prior knowledge or ask the user’s expertise level manually as an alternative). 
2. The user clicks **“Start”** to analyze the paper. We then: 
    - Possibly navigate to a **PDF view page** (/pdf/[id]) where the PDF is loaded. But per the design request, instead of just showing the PDF to read manually, we’ll directly begin analysis. We might briefly show the PDF or title for context, then fade into a loading screen. 
    - Show an **“Analyzing paper…”** message or animation. During this time, on the backend our process kicks off. 
3. **Backend Analysis (API)**: We may create an API route like /api/analyze (or reuse /api/chat from asXiv for both summary and QA). Here’s what happens: - **Fetch Paper Content**: Given the arXiv ID, fetch the paper’s PDF. Use a library or a direct HTTP GET to https://arxiv.org/pdf/{id}.pdf. If PDF is fetched server-side, we can extract some text: - Extract the **abstract** (often the first part of text or we can get it from arXiv’s metadata API by hitting http://export.arxiv.org/api/query?search\_query=id:ID which returns XML with the abstract). - Possibly extract **section headings** or a table of contents by scanning the text for sections (if the PDF text is accessible) or using a PDF outline if available. - Extract **figure captions** or at least note figure placements. We might use keywords like “Figure” or look for images in the PDF – this is advanced; at minimum, we’ll gather the text around “Figure X:” if present, to later include figure explanations. - **Summarization Prompt Construction**: Construct a prompt for the LLM that includes: - The Kontext **system prompt** for user (if personalization is on) – containing facts about the user’s background. - The **task description** – e.g. “Summarize the following paper for [user persona or general audience]. The summary should explain the main points in simple terms, include important details like key results, and explain any figures or charts. Tailor the explanation to assume knowledge of [user’s known areas] and explain or define concepts outside that knowledge.” - The **paper content** – we might not feed the entire paper due to token limits, but we can provide the abstract and a structured outline of the paper. For instance: “Title: … Abstract: … Key Sections: 1. … (with one-sentence summary each) … Conclusion: …”. Alternatively, since GPT-4 can handle a lot of text (up to 8K or more tokens), we might include the important parts of the paper directly. - We could also do this in multiple passes: first ask the model to list the key topics of the paper given abstract + headings, then identify prerequisites, etc. However, an iterative chain might be slow. A simpler approach: ask the model in one go to produce a summary **and** to automatically clarify prerequisites considering the user’s persona. For example: ''“User’s background: [from Kontext]. Paper: [abstract + main points]. Now write a summary addressing an educated layperson with the user’s background, explaining any domain-specific terms they might not know.”'' - If the user is not personalized, we may assume a baseline (like a general science graduate level) or ask the user’s preference (we can incorporate a field like “Your familiarity: [Novice/Intermediate/Expert]” on the home page to guide the level of detail). - **LLM Summarization**: Call the OpenAI API (or Gemini API) with this prompt. The model will return a multi-paragraph summary. We will parse the response and possibly post-process it: - Ensure any references to pages or figures are in the format “(page N)” so we can hyperlink them to the PDF viewer[https://github.com/montanaflynn/asxiv#:~:text=The%20AI%20uses%20a%20standardized,parsing%20while%20maintaining%20clean%20functionality [9]]. We might add a rule in the prompt: “When referring to the paper, cite the page number as (page X).” - The model’s text may already include figure explanations if we prompt it to. If not, and we have figure captions separately, we could consider inserting them or augmenting after. - Also, the model might not perfectly tailor to the user without guidance. If needed, we can do a second pass: scan the summary for any term that might be too advanced given the user’s profile. If found, we could prompt the model again just for an explanation of that term, then inject it into the summary or provide it as a footnote or tooltip. (This is an enhancement; might not be in the first iteration.) - **Identify Prerequisite Questions**: As an optional step, we can have the model (or some logic) list any concepts in the paper that are likely prerequisites. E.g., if the paper is about a new optimization algorithm, prerequisites might be “gradient descent”, “convex optimization”, etc. We compare this list with the user’s known topics from Kontext. For any unknown items, we prepare a question to ask the user when we reach that part. The initial summary generation might have placeholders or markers for where to ask. However, implementing this seamlessly is tricky. Another approach: we deliver the full summary to the user, and ''then'' prompt the user (maybe via a highlighted text or an icon next to terms) to check if they want an explanation. This might be a simpler UI: certain terms could appear underlined (indicating “you might not know this – click to learn”). If the user clicks, we show a small explanation (which could be pre-fetched from the LLM or generated on the fly). We will consider this interactive approach instead of pausing the summary for Q&A. It achieves a similar goal without interrupting the reading flow. - **Return Data**: The API returns the summary (and possibly structured data like a list of figures with their captions, or a list of glossary terms explained). 4. **Displaying the Summary**: The front-end, upon receiving the summary data, will transition from the loading state to the **Summary View**. In this view: - We render the summary text in a nice formatted way. Use headings for sections if the summary is structured (for example, the model might output an outline or we might break the summary by the paper’s sections). - Embed images/charts if possible: This is a challenge, but we have a few strategies: - If we managed to extract figure images from the PDF: we can display them with the model’s explanation or caption beneath. We’d have to have saved them (perhaps as base64 data URIs or blob URLs). Another idea is to use the PDF.js viewer: we could programmatically render just the region of a page that contains a figure to an <canvas> and convert to image. For MVP, we might skip actual image embedding and instead rely on the PDF viewer: e.g. when the summary says “Figure 2 (page 5) shows X”, the user can click that reference and the PDF viewer (which could be hidden or minimized behind) will jump to page 5 and highlight the figure. - At minimum, ensure that figure captions or descriptions are included in the text. The summary should not ignore visuals since they often carry key info. We will instruct the model to include descriptions of important figures in the summary. - The **PDF viewer**: We can have the PDF loaded in a component (perhaps hidden by default once summary is shown, or minimized to a side-by-side view). A good approach is a split view: left side the summary, right side the PDF (like asXiv did with chat vs PDF). But the user’s design notes seem to imply replacing the PDF with the summary entirely after analysis. We could still keep the PDF accessible via a toggle or when clicking page references. So an implementation could be: the PDF viewer component is present but not visible; clicking a “(page X)” reference in the summary would slide open the PDF view and scroll to that page for a quick look. - **Knowledge check interactions**: If we decided on inline highlights for unknown terms, implement those. E.g., terms that the user likely doesn’t know are styled with a dotted underline. Hovering or clicking could show a tooltip with an explanation (which we can generate on demand via the chat API, or pre-generate some glossary). If using a tooltip might be complicated, we can simply use the chat: e.g., if the user highlights a term or sentence in the summary and clicks “Explain this”, that triggers a question to the chat system like “Explain the term <X> as it relates to this paper.” The answer then appears in the chat widget. - Provide an interface element to open the **ChatWidget** (like a floating button “Ask a question”). The ChatWidget (from asXiv’s ChatWidget.tsx) will be integrated, possibly improved in UI to match our design. It could appear as a popup overlay or a side drawer. 5. **Question & Answer Flow**: When the user asks a question in the chat: - The question (and possibly context of what they have highlighted or which section they’re asking about) is sent to our /api/chat endpoint (similar to asXiv’s implementation). - The backend will locate relevant context from the paper. We can use a simple approach: if the question references “Figure 2” or a specific term, we find that in the paper text (maybe using an index of text by page we prepared earlier). Alternatively, we might embed the text of the paper in a vector index and do a similarity search to find relevant passages (this is an advanced option; initially, since the LLM is powerful, we might attempt to feed as much of the paper as fits along with the question). - We call the LLM with a prompt that includes relevant excerpts (or the whole paper if feasible) plus the user’s Kontext profile (for personalization) and the user’s question. The model will generate an answer, which we send back to the UI. - The answer might include page references – we ensure they remain properly formatted so clicking them scrolls the PDF viewer. - We update the Kontext profile if the interaction reveals something (for example, if the user explicitly asked “What does X mean?”, we might mark X as now learned after we answer it, or at least know they had a question on X). - The chat interface will show the conversation (we should maintain the state so the user can see previous Q&As, akin to a typical chat). 6. **Posthog Analytics**: Throughout the above flows, we will sprinkle event tracking: - On paper load & summary completion, trigger a posthog.capture('Paper Analyzed', {paperId: ..., personalized: true/false}). - On user connecting a data source, posthog.capture('Persona Connected', {source: 'Gmail'}). - On each question asked, posthog.capture('Question Asked', {paperId: ..., highlightContext: ...}) etc. This data will help improve the product later. We will use the PostHog JS client in the frontend for UI events and possibly the PostHog Node client in API routes for backend events.

### Implementation Steps (Tasks Breakdown)

Below is a breakdown of the development tasks, along with notes on **how** to implement them and which **MCP tools** (Model Context Protocol connectors) might assist in the process:# **Set Up Next.js Project**''Task:'' Initialize a new Next.js TypeScript project for the application. Create the basic file structure.''Details:'' Use create-next-app (with TypeScript template) for a quick start. This gives us a default project with a pages directory, etc. We will configure it as needed (e.g., add .env.local for API keys). If starting from the existing asXiv codebase, alternatively fork or copy it as a base – but that might include features we’ll heavily modify. Starting fresh and extracting just what we need from asXiv might be cleaner.''MCP Tools:'' Use [mcp\_servers.deepwiki] to reference the **asXiv repository** for any setup hints. For example, ask DeepWiki about asXiv’s project structure and any Next.js config they used (which we saw in README) to ensure we align on folder setup and dependencies. DeepWiki can also help recall how certain components (like their ChatWidget) were implemented. If needed, consult Next.js docs via a web search (enable a web search tool or documentation tool if available) for any configuration questions.

\# **Implement Paper Retrieval & PDF Viewer**''Task:'' Build the mechanism to fetch and display the arXiv paper.''Details:''


\*\* Create a Next.js dynamic route pages/pdf/[...arxivId].tsx similar to asXiv[https://github.com/montanaflynn/asxiv#:~:text=%E2%94%9C%E2%94%80%E2%94%80%20pages%2F%20%E2%94%82%20%20,Global%20styles [10]]. This page will handle displaying the PDF in the browser. We can use the pdfjs-dist library or Next.js’s built-in static file serving. One approach is to use an <iframe> pointing to the arXiv PDF URL, but for better integration (like linking to pages), it’s preferable to use PDF.js to render inside our app. We will include the PDF.js script or use the npm package, and then load the PDF by URL. Ensure CORS is allowed for arXiv PDFs – arXiv does allow cross-origin for PDFs. If any issues, we might use Next.js API as a proxy to fetch the PDF.

\*\* The PDF viewer should support jumping to specific pages. PDF.js provides a way to navigate to a page if we have a reference. We might set up a small mechanism where clicking a "(page X)" link in the summary calls a function in the PDF viewer component to scroll to page X. (In asXiv, they achieved this by recognizing the (page N) text pattern and making it clickable with a JavaScript handler[https://github.com/montanaflynn/asxiv#:~:text=The%20AI%20uses%20a%20standardized,parsing%20while%20maintaining%20clean%20functionality [9]]. We can do similarly – perhaps using a custom React component to render such references in text.)

\*\    - **ArXiv data fetching**: Implement a helper to retrieve at least the abstract and title from arXiv API by ID. This will be used in the summary generation. The API returns XML; we can parse it or use a package. Alternatively, use arXiv’s RSS feed or a simple HTML fetch from the arXiv abs page (which has the abstract in HTML).

\*\* If time permits, implement a server function to extract text from the PDF for the AI. A simple route like /api/extract?id=XYZ can utilize a PDF parsing lib (like pdf-parse or PDFExtract) to get raw text. This will help in summarization.''MCP Tools:'' Use [mcp\_servers.deepwiki] to inspect **asXiv’s PDF viewer code** or search for how PDF.js is integrated. For example, ask “How does asXiv implement the PDF viewer and link to pages?” This can yield insight or even code snippets to guide our implementation. If needed, use [mcp\_servers.deepwiki] to find relevant lines in their ChatWidget.tsx or pdf/[...arxivId].tsx.

\# **LLM API Integration (Chat API Route)**''Task:'' Set up the backend route that will communicate with AI models (OpenAI GPT-4 and optionally Gemini).''Details:''

\*

\*\* We will create pages/api/chat.ts (like asXiv) or perhaps separate routes for summary vs Q&A. A unified /api/chat that handles both could work: it can check the request payload for a type (e.g. "type": "summary" vs "type": "question"). For a summary request, it triggers the summarization flow; for a question, it triggers the Q&A flow. This keeps logic centralized.

\*\* In this route, integrate the **OpenAI API** calls. Use the official OpenAI Node SDK (openai npm package) or just fetch to their REST endpoint. For GPT-4, ensure we handle streaming vs non-streaming (initially, non-streaming is simpler – get the full response then send it). We need the OpenAI API key in env.

\*\* If supporting Gemini (Google PaLM API via AI Platform), we’ll include logic to call that if configured. As per asXiv, the Gemini API key is used and the model ID is configured by env (GEMINI\_MODEL). We can reuse that approach: if GEMINI\_API\_KEY is present, call Google’s model endpoint. (Note: Google’s Gemini access might be limited; we can skip unless the user has keys. But mention it in documentation that both are supported).

\*\* Test the API route with a simple prompt to ensure it’s working. For now, a quick test could be hitting it with a dummy question and logging the response.''MCP Tools:'' [mcp\_servers.deepwiki] can be used to open **asXiv’s pages/api/chat.ts** to see how they structured the calls to Gemini and how they handle incoming requests. This will help implement our version quickly. Additionally, use [mcp\_servers.kontext] (if available in a dev context) to verify how to call the Kontext API (e.g., we might test calling getProfile using the tool to see what data comes back with a dummy user profile). This will guide how we format our requests in code.

\# **Kontext Persona Integration**''Task:'' Integrate Kontext.dev for user personalization in both frontend and backend.''Details:''

\*

\*\    - **Frontend (React)**: Install Kontext SDK (@kontext.dev/kontext-sdk and possibly @kontext.dev/persona-sdk if needed). Use the provided React components or API to implement a **Connect Data** button. For example, the docs show a KontextConnectButton component[https://docs.kontext.dev/examples/react#:~:text=React%20, [8]] which likely handles the OAuth pop-up. We will place this on the home page, perhaps with an explanation (“Connect your Gmail to personalize explanations to what you know.”).

\*\* When the user connects, we should get a Persona object or at least a confirmation. We’ll need to retrieve a userId that represents this user in Kontext. Possibly the SDK handles storing it, but we should verify. The SDK might allow calling persona = new Persona({ apiKey }) and then await persona.connect("gmail") etc. We should consult Kontext’s docs or use [mcp\_servers.deepwiki] to search the Kontext SDK usage example (the search result shows something about Persona and Gmail in Node SDK[https://docs.kontext.dev/examples/node#:~:text=Node.js%20,flow%3B%20Personalized%20chat%20API [11]]).

\*\* Once connected, update UI state (e.g., show “Personalization Enabled” and perhaps list which sources are connected).

\*\    - **Backend**: On our API route, incorporate calls to Kontext. Likely steps:

\*\* Initialize a Kontext API client using our API key (maybe just simple REST calls if not using their Node SDK server-side). For simplicity, we might do a direct HTTPS request to their endpoint /v1/context with the userId and task. The docs snippet [https://docs.kontext.dev/api-reference/get-context#:~:text=Get%20Context%20,from%20%27%40 [12]] suggests a POST /v1/context with body containing something like sources. If using their Node SDK, maybe a function like persona.getContext(task, userQuery).

\*\* For summarization: call getProfile or getContext before the LLM call. Get the systemPrompt or “personalized context” as they call it. This likely comes as a block of text about the user (“The user is a software engineer with a background in ML, not familiar with advanced calculus,” etc). Prepend or incorporate this into the LLM’s system message. We must be careful to format it properly so the model treats it as context about the user, not about the paper.

\*\* For Q&A: similarly get context with the current question as userQuery for more targeted facts (maybe it knows the user recently read something related or had trouble with a concept before).

\*\* Handle the case of no personalization: If the user didn’t connect Kontext, we skip this step or use a default profile (we can create a dummy context like “Assume the user is not an expert in the paper’s field unless specified otherwise.”).

\*\* Also, prepare to update Kontext: If there’s an API to add facts, when the user confirms knowledge of a concept, call that (e.g., persona.addFact({ fact: "Knows Concept X" })). If no direct API, we might incorporate it as a feedback in the next getProfile call (some systems allow adding “userFeedback” in context). We’ll check Kontext’s documentation for any mention of updating profiles. Possibly, the **MCP Kontext server** could help (maybe [mcp\_servers.kontext] provides methods to update profile).

\*\    - **Dynamic Persona from external sources**: The user also mentioned connecting GitHub, Twitter (X), LinkedIn as possibilities. We should note that Kontext might not support all these yet, but Gmail is a primary one. We’ll design with an extensible approach: the connect flow could allow multiple sources (the Kontext button might handle multiple or we have separate buttons). For now, implement Gmail which is likely default, and mention that extending to other sources is possible when Kontext supports it or if the user provides those APIs. ''MCP Tools:'' Use [mcp\_servers.kontext] to assist coding this integration. For instance:

\*\* Use it to retrieve documentation or function signatures for the Kontext SDK (e.g., how to initialize Persona, how to call getProfile).

\*\* Possibly use it to simulate an API call for testing (though it might not have direct net access, but if it’s a specialized tool maybe).

\*\* If available, also consider enabling a **Web Search** MCP to find examples of Kontext integration from any developer blogs or the Kontext documentation for Node (the search result [15] shows Node.js SDK usage). This will ensure we correctly implement the connect flow and context retrieval.

\# **Summary Generation Logic**''Task:'' Implement the core logic that generates the summary using the LLM, integrating paper content and personalization.''Details:''

\*

\*\* In the /api/chat (or /api/analyze) handler for summary, implement the steps described:

\*\* Fetch paper data (title, abstract, possibly intro or sections). This might already be done in a helper (from step 2, PDF parsing). Use that to build a prompt.

\*\* Fetch user context from Kontext (step 4).

\*\* Construct prompt for the model:

\*\*\* System message could combine a generic instruction + personalization. For example:"You are a researcher’s assistant. Provide a clear summary of the paper, tailoring it to the user's knowledge. \n\nUser Profile: ${personalContext}\nPaper Abstract: ${abstract}\n[Possibly other content]\nInstructions: Explain the paper in simple terms, mention key results, and don't assume knowledge outside the user's profile. If the paper includes important figures or graphs, describe them. Use (page N) to reference pages."

\*\*\* The user message might be something like: "Please summarize the paper '${title}'." (Alternatively, we put everything in system and have no user message since it’s one-shot.)

\*\* Call the model (OpenAI ChatCompletion).

\*\* Upon getting the summary text, parse it for our needs:

\*\*\* Possibly split into sections if the model delineated any (the model might output with headings if prompted to).

\*\*\* Find occurrences of “(page X)” – ensure they are properly formatted. If the model didn’t include them, we might do a post-pass: for each figure or reference the model mentions, if we know the page from our earlier extraction (e.g., if it says “Figure 2”, we likely know which page that is from parsing PDF), we can append “(page Y)” to that sentence. As an MVP, instructing the model to output page references might be sufficient.

\*\* Send the summary back in the response (along with maybe any metadata like a list of page references for linking).

\*\* Also consider the performance: If the paper is long, the model might not handle all content at once. We might chunk the paper and summarize iteratively (e.g., summarize each section then combine). But this can be complex; start with direct summarization using the abstract + maybe conclusions for context. The quality should be acceptable for an overview. We can refine later with multi-pass if needed.

\*\    - **Prerequisite identification**: Implement a basic check for prerequisite concepts. One idea: maintain a list of domain-specific terms (maybe from a glossary or by scanning the paper for capitalized terms, acronyms, etc.) and cross-check with user profile. However, doing this thoroughly might be too advanced for the first iteration. Instead, rely on the model + user profile to automatically simplify. E.g., if the user profile says they are not familiar with advanced math, the model might automatically include explanations of any math concepts in simpler terms. So, if our prompt is good, this feature might implicitly happen. We’ll document that the interactive questioning of prerequisites is a goal, and maybe leave hooks to add it later (like marking terms in the UI as described). ''MCP Tools:'' For developing the prompt and logic:

\*\* [mcp\_servers.deepwiki] can be used to find if asXiv had any prompt engineering or logic in generating their recommended questions. That might give insight on how they parsed the paper for questions. We can see if they chunked the PDF in chat.ts.

\*\* We can also use [mcp\_servers.deepwiki] to search for known best practices of summarizing PDFs or see if any open-source project (like “RisuAI” or “Curiso” mentioned in LibHunt alternatives[https://www.libhunt.com/r/asxiv#:~:text=Which%20is%20the%20best%20alternative,chat%2C%20Curiso%2C%20Embedelite%2FChat%20or%20Chat.md [13]]) have code for summarization we can learn from.

\*\* [mcp\_servers.kontext] might help ensure our usage of the persona data in the prompt is correct, maybe by asking it how to best incorporate user facts into an LLM prompt.

\*\* If available, a **Web Search** tool might find prompts or papers on “personalized text summaries with user knowledge” – though not strictly necessary, it could inspire how to format the user model input.

\# **Interactive Q&A Chat**''Task:'' Integrate and enhance the chat interface for follow-up questions.''Details:''

\*

\*\    - **ChatWidget UI**: Leverage the ChatWidget.tsx from asXiv as a starting point[https://github.com/montanaflynn/asxiv#:~:text=src%2F%20%E2%94%9C%E2%94%80%E2%94%80%20components%2F%20%E2%94%82%20,supports%20ArXiv%20IDs [14]]. This component likely includes a text input and a display of the conversation. We will adapt its styling to fit our design (the CSS module can be modified for our theme). Possibly position it as an overlay or a toggleable panel. Ensure it can display both user questions and assistant answers with nice formatting (maybe use a library for rendering Markdown or just simple HTML text, since answers might include LaTeX or references? AsXiv might have handled math or special formatting if needed – check if they did anything for equations).

\*\    - **Backend for Q&A**: In the API route, handle the Q&A differently from summary:

\*\* Accept the user’s question and possibly a context pointer (maybe the frontend sends the current paper ID and optionally which section/page the question is about).

\*\* Retrieve user profile context via Kontext (again).

\*\* Retrieve relevant paper text: We can implement a simple retrieval by using the PDF text we extracted. For example, if the question contains “Figure 3” or certain keywords, search our stored text for that section and include some sentences around it. Alternatively, include the whole abstract and conclusion at least in the prompt as additional context (since those are always relevant).

\*\* Construct a prompt: system message can be similar (“You are an AI assistant answering questions about a research paper to a specific user...”), include user profile, possibly include some extracted text if directly relevant. The user message will be the user’s question.

\*\* Call the LLM for the answer. Stream the answer if possible for better UX (this could be a nice-to-have; asXiv might not have streaming, but OpenAI’s API supports it).

\*\* Send the answer back.

\*\    - **PDF page linking**: If the answer references something in the paper, ensure the format “(page X)” is applied. We might add a step: after getting the answer text, scan for any mention of e.g. “page 5” or figure numbers and standardize them. We can also instruct the model in the system prompt to use that format for any references to the paper. That way, when the answer is displayed, those become clickable (we’ll implement in the ChatWidget rendering: detect (page N) and wrap in a link or button that triggers the PDF scroll).

\*\    - **Highlight -> Question**: Implement the ability for the user to highlight text in the summary and ask a question about it. This can be done by capturing the selected text and pre-filling the question input like: "What does \"<selected text>\" mean in this context?" or "Can you explain more about <selected text>?". This is a front-end enhancement that improves UX. It can be done later, but we should structure the code to allow passing context to the question API (maybe as highlightText).

\*\    - **Update knowledge**: If a question clearly indicates a new concept was learned (like the user asked “What is X?” and got an explanation), we might want to call Kontext to add that as known. This might be too implicit to do automatically, but we could consider prompting the user “Mark this concept as known for future?” as a little UI element after an explanation, and if they confirm, then use Kontext API to record it. This is an optional nice-to-have. ''MCP Tools:''

\*\* [mcp\_servers.deepwiki] can help by reviewing **asXiv’s Q&A logic**. For example, see if chat.ts does any context retrieval (maybe they chunked the PDF by pages and only gave the model certain pages based on the conversation). DeepWiki can search for keywords like “context” or “messages” in that file.

\*\* If the asXiv project or others used vector search, DeepWiki might show that; if not, we’ll proceed with simpler methods.

\*\* Also, use [mcp\_servers.deepwiki] to see how they implemented the page reference linking in ChatWidget (maybe a regex on output text).

\*\* [mcp\_servers.posthog] could be used here to instrument events in the code (like capturing that a question was asked), but primarily this step is about functionality. We will incorporate PostHog in the next step.

\# **UI/UX Implementation and Polish**''Task:'' Bring the front-end together with proper styling and ensure the user experience flows as intended.''Details:''

\*

\*\    - **Home Page Design**: Create a clean landing page (index.tsx). Include a title (project name or tagline), an input field for ArXiv ID (with placeholder text like “e.g. 1706.03762”), and the Kontext connect button. Possibly also a brief description or bullet points on what the tool does, to set user expectations. Keep it minimal – maybe similar to a Google search page style: just a logo and inputs in center. The personalization option could be a section below the ID field, or a pop-up if they click “Personalize”. Make sure to handle the case if they decline auth or it fails (error feedback).

\*\    - **Loading Screen**: Design the transition after clicking Start. Could use a full-screen overlay with “Analyzing…” and a spinner. The user mentioned a specific loading animation (the link suggests maybe a pattern animation). We can find a simple CSS spinner or use an SVG. Ensure to also handle if analysis is quick vs slow (for a long paper, it might take 10-20 seconds or more to get a response from the model). Perhaps include some witty loading messages or progress indicators (optional).

\*\    - **Summary Display**: Format the summary text with appropriate typography. Use headings (<h2> etc.) for sections if the summary has them. Use lists for key points if provided. We may apply a max-width to the text column for readability. The style should be similar to reading a blog post or article (since Notion-like was mentioned: maybe a white background, black text, clean font, decent spacing). If using global CSS, define styles for elements like h2, p, li, etc., or use a utility-first approach (maybe integrate Tailwind CSS to speed up styling if desired, though that might conflict with CSS module approach; given asXiv used plain CSS, we can continue with that for consistency).

\*\    - **Incorporating Images**: If we extracted any figure images and we want to display them, now is the time to integrate that. For example, we could have a placeholder in the summary like “[Figure 2 here]” if the model included it, and we replace it with an <img> tag. Or simply, we can insert images manually in the summary component: e.g., if we know page 5 has a figure and the model talked about it, we can render an image for that page (by using PDF.js to render page 5 to a canvas and then to data URL). This could be complex, so an alternative is to allow the user to click a “Show Figure” button next to the figure description that triggers the PDF viewer on that page. We’ll choose what’s feasible in our timeframe; likely linking to PDF is easier for MVP.

\*\    - **Chat UI**: Style the chat popup. Possibly overlay it at bottom-right (typical chat bubble style), or as a side panel splitting the screen. It should not cover the summary text entirely if possible, so the user can see both the question and the content. A resizable or draggable panel could be nice but not required initially. Ensure the chat input is always visible and the chat history scrolls. Use a contrasting background for chat (maybe slightly gray background for the chat area to distinguish from the white summary area).

\*\    - **Responsive design**: Ensure that on smaller screens (if needed), things still work – perhaps the summary and chat would not be side by side but toggleable. Desktop is the main target (reading papers on mobile is tough anyway), but we can make sure it’s at least usable on a tablet.

\*\    - **Notion/AppFlowy inspiration**: Perhaps incorporate subtle design elements like:

\*\* A sidebar or topbar with the project name.

\*\* A clean sans-serif font similar to Notion’s default (e.g. use system font or something like “Inter”).

\*\* Minimal icons and controls (only what’s needed, e.g. a gear icon for settings if any, a help icon maybe).

\*\* We can look at AppFlowy’s UI screenshots for layout ideas (AppFlowy is an open-source Notion alternative; it has a document page view which might be overkill here). Notion’s simplicity (just a centered column of text) might be enough.

\*\* Possibly animate the transition where the PDF/abstract moves out. We can do a simple fade-out of the PDF pane and fade-in of summary. ''MCP Tools:'' Use [mcp\_servers.deepwiki] to gather design inspiration or even code snippets:

\*\* For example, search AppFlowy’s GitHub for their UI components or CSS to see how they style their main content area. While it’s a different tech stack (AppFlowy is Flutter/Rust), maybe they have some CSS for web or a design guideline.

\*\* Search for “Notion clone CSS” or any existing React components that mimic Notion (there might be libraries or examples on GitHub for Notion-like editors; even though we don’t need full editor, maybe the styling tips).

\*\* If a **Web search** MCP is available, we could find articles on “minimalist web design for reading” or look at the CSS of Medium.com or Notion for reference.

\*\* [mcp\_servers.posthog] can be used here to integrate the PostHog snippet properly. Possibly it has a quick command to add the snippet or ensure the API calls from Node are correctly set up. We might also use it to consult PostHog’s documentation for Next.js integration (for example, whether to put it in <Head> or use their npm package).

\*\* After implementing UI, we will also test the flow – here [mcp\_servers.posthog] will help in verifying events are firing (maybe by checking a PostHog console, if accessible via an API).

\# **Testing & Iteration**''Task:'' Test the entire application and refine as needed.''Details:''

\*

\*\* Manually run through a scenario: choose a known arXiv paper (e.g., “Attention is All You Need” as in the asXiv demo). Try with personalization off first. Verify the summary makes sense, the page links navigate the PDF, and the chat can answer a question (like “What is self-attention in this paper?”) with a reasonable answer that includes a page reference.

\*\* Then test with personalization on: perhaps create a dummy persona that lacks ML background and see if the summary explains more basics (or artificially adjust the persona by providing some dummy “user facts”). If needed, tweak the prompt to better incorporate that (this might involve adding explicit instructions like “If the user is not familiar with X, include a brief explanation of X”).

\*\* Check edge cases: missing or invalid arXiv ID, API errors (like OpenAI API fails or times out). We should handle errors gracefully – e.g., show an error message to user “Sorry, something went wrong. Please try again.” and not leave a loading screen hanging.

\*\* Performance: The first summary generation might be slow. Consider adding intermediate feedback, like “Reading abstract… Summarizing…” if it’s really slow. Or perhaps generate the list of recommended questions (as asXiv does) to display while the user could already think of what to ask – but since we focus on summary, this is optional.

\*\    - **Future Enhancements Note:** Document ideas like integrating a more robust PDF parsing or vector database for better answering, adding support for uploading any PDF (not just arXiv) possibly via an OCR or PDF text extractor (the user mentioned deepseek-ocr for future), and connecting additional personal data sources (e.g., maybe their Zotero library or other knowledge sources) to Kontext.

\*\* Once it works, prepare the PLAN.md (this document) and then move on to writing a TASKS.md with these tasks as actionable prompts for the development workflow (if needed by the Codex pipeline). ''MCP Tools:'' In testing phase:

\*\* [mcp\_servers.posthog] will confirm analytics events are coming through (maybe via an API call to query events or simply checking the PostHog dashboard manually).

\*\* [mcp\_servers.kontext] can help verify that our calls to the profile API are returning expected data for a test user.

\*\* [mcp\_servers.deepwiki] might still assist if any debugging is needed by referencing docs or similar projects.

\*\* If any additional MCP seems useful (like a **GitHub MCP** to commit code or manage repo, or a **Browser** tool to search for quick bug fixes), we should ensure they are installed as needed. For example, a GitHub integration MCP could allow the assistant to push changes or read issues if using an AI-driven dev environment – not strictly necessary but could be useful in the workflow.



### Additional Considerations

    - **Security & Privacy**: Because we are dealing with personal data (via Kontext) and possibly private papers, we must ensure that all API keys (OpenAI, Kontext, PostHog, etc.) are kept server-side and not exposed. The user’s data fetched via Kontext (like email-derived facts) should not be stored on our server beyond the session; it should be fetched as needed and treated carefully. Also, the PDF content might be sensitive (though arXiv is public), but if later we allow uploads of private PDFs, we’ll need to ensure they’re not stored or leaked. Using Kontext also ensures we’re not directly scraping user’s Gmail in our app; Kontext handles data securely on their side and just gives us relevant facts.
    - **Licensing**: asXiv is MIT licensed[https://github.com/montanaflynn/asxiv#:~:text=License [15]], so we can reuse its code within the terms of that license. We should attribute any significant code we use (perhaps in our README). Likewise, PDF.js is open source and allowed to use.
    - **MCP Tools Setup**: The development environment (e.g., using Simtheory or Continue) should have the following MCP servers:
* [mcp\_servers.deepwiki] – for searching repository docs (used for referencing asXiv and possibly others).
* [mcp\_servers.kontext] – to integrate with Kontext API during coding and testing.
* [mcp\_servers.posthog] – to integrate PostHog analytics.
    - **Suggested Additional Tools**:

\*\* ''Web Search/Crawl MCP'': to enable general web info retrieval (useful for design inspiration and troubleshooting unknown issues).

\*\* ''GitHub MCP'': to directly fetch code from other GitHub repos (if deepwiki is limited to wikis/docs, a GitHub file reader could be useful to pull specific files like AppFlowy’s CSS or components).

\*\* If planning advanced features, perhaps an ''OCR or PDF MCP'' (if exists) for handling PDF content in future (for example, a “Document Analysis” MCP was listed in Simtheory[https://simtheory.ai/mcp-servers/deepwiki/#:~:text=Web%20search%20Generate%20professional,13 [16]] which might help extract text from PDFs using AI).

\*\* Ensure these are installed or note that we plan to use them so the environment is prepared.

    - **Timeline & Iteration**: This plan is quite comprehensive; implementing everything (especially the interactive prerequisite Q&A logic and image extraction) might be ambitious for a first version. It’s okay to iterate:
    - **MVP**: Focus on getting the end-to-end flow working: enter paper -> see summary -> ask questions. Ensure personalization via Kontext at least uses the user’s profile in the prompt (even if it’s not dramatically different yet).
    - **Next**: Add the nice-to-haves like highlight-to-ask, interactive concept explanations, and figure image rendering.
* Keep track of which features are implemented in tasks versus which are future enhancements, so we can prioritize during development.



By following this plan, we will build a functional prototype of a personalized paper summarizer tool with a solid foundation (Next.js + LLM + Kontext integration), and we’ll be able to incrementally refine the user experience with more interactive and intelligent features.


[https://news.ycombinator.com/item?id=45292648#:~:text=Shameless%20plug%20but%20I%20made,arXiv.org%20papers%20questions [1]] 

[https://news.ycombinator.com/item?id=45292648#:~:text=I%20built%20it%20because%20it,it%20and%20give%20a%20prompt [2]]  Learn Your Way: Reimagining Textbooks with Generative AI | Hacker News

[https://docs.kontext.dev/documentation/welcome#:~:text=Kontext%20is%20the%20context%20layer,ensure%20full%20auditability%20and%20security [3]] 

[https://docs.kontext.dev/documentation/welcome#:~:text=,enforces%20privacy%20when%20building%20context [4]] Welcome to Kontext - Kontext SDK

[https://github.com/montanaflynn/asxiv#:~:text=,Get%20one%20here [5]] 

[https://github.com/montanaflynn/asxiv#:~:text=GEMINI\_MODEL%3Dgemini [6]] 

[https://github.com/montanaflynn/asxiv#:~:text=,for%20the%20amazing%20React%20framework [7]] 

[https://github.com/montanaflynn/asxiv#:~:text=The%20AI%20uses%20a%20standardized,parsing%20while%20maintaining%20clean%20functionality [9]] 

[https://github.com/montanaflynn/asxiv#:~:text=%E2%94%9C%E2%94%80%E2%94%80%20pages%2F%20%E2%94%82%20%20,Global%20styles [10]] 

[https://github.com/montanaflynn/asxiv#:~:text=src%2F%20%E2%94%9C%E2%94%80%E2%94%80%20components%2F%20%E2%94%82%20,supports%20ArXiv%20IDs [14]] 

[https://github.com/montanaflynn/asxiv#:~:text=License [15]] GitHub - montanaflynn/asxiv: An AI-powered interface for exploring and understanding arXiv research papers

[https://docs.kontext.dev/examples/react#:~:text=React%20, [8]] React - Kontext SDK

[https://docs.kontext.dev/examples/node#:~:text=Node.js%20,flow%3B%20Personalized%20chat%20API [11]] Node.js - Kontext SDK

[https://docs.kontext.dev/api-reference/get-context#:~:text=Get%20Context%20,from%20%27%40 [12]] Get Context - Kontext SDK

[https://www.libhunt.com/r/asxiv#:~:text=Which%20is%20the%20best%20alternative,chat%2C%20Curiso%2C%20Embedelite%2FChat%20or%20Chat.md [13]] Asxiv Alternatives and Reviews - LibHunt

[https://simtheory.ai/mcp-servers/deepwiki/#:~:text=Web%20search%20Generate%20professional,13 [16]] DeepWiki MCP - MCP Directory by Simtheory
