# Feature Specification: Visual Canon Relationship Graph & Publication-Grade Multi-Format Export Suite (003-visual-canon-graph-export)

**Feature Code**: `003-visual-canon-graph-export`  
**Status**: Draft  
**Created**: 2026-09-03  

---

## 1. User Scenarios & Problems to Solve

### 1.1 Existing Limitations
1. **Abstract Relationship Tracking**: Authors with 30+ characters and complex faction hierarchies struggle with tabular lists and text notes. Lack of visual link topology leads to forgotten secondary characters or contradictory relationship dynamics.
2. **Invisible Causal Commitments**: Narrative contracts (`CausalContract`), character debts, and revenge oaths live in JSON/YAML data stores; authors have no visual timeline to see when a contract was sworn and whether it is fulfilled or breached.
3. **Publication Friction**: Exporting novels to submission-ready Word (.docx), clean TXT for writer platforms (Qidian/Fanqie author portals), or formatted EPUB requires tedious manual typesetting.

---

## 2. Functional Requirements

### 2.1 Interactive Visual Canon Relationship Graph (Canvas / Visual Nodes)
- **FR-1.1 Entity Nodes & Clustering**: Interactive canvas rendering Characters, Factions, Items, and Locations as distinct color-coded visual nodes with thumbnail/avatar and role labels.
- **FR-1.2 Relationship Edges & Annotations**: Visual directed edges representing alliances, bloodlines, master-disciple links, rivalries, and romantic interests with relationship descriptions.
- **FR-1.3 Causal Contract Overlay**: Visual timeline/contract badges marking active promises, deadlines, and breach conditions linked between characters.

### 2.2 Publication-Grade Multi-Format Export Suite
- **FR-2.1 Standard Editor Word (.docx) Export**: Formats chapter headings (Bold Heading 2), body text (Songti/SimSun font, 2-character first-line indentation, 1.5 line height), author metadata, and synopsis into industry-standard editor submission format.
- **FR-2.2 Web Novel Platform Clean TXT Export**: Auto-strips markdown syntax, enforces clean double-line breaks, formats dialogue quotation marks, and validates character limits for Qidian/Fanqie author portal paste.
- **FR-2.3 Reader EPUB Package**: Compiles full book volume structure, generates cover page, table of contents (NCX), and metadata for immediate e-reader consumption.
