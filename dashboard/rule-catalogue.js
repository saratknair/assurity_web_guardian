// Rule_Catalogue: static, human-authored plain-English explanations keyed by axe rule id.
// Authoring rules: ASCII only; every field non-empty; what/who/fix start with a named subject
// (never a bare pronoun); no unresolved placeholders; scope is "page" or "elements".
// Rule ids not listed here use the generic fallback (published description and help only).

export const RULE_CATALOGUE = {
  "link-name": {
    scope: "elements",
    what: "Some links have no text that a screen reader can announce",
    who: "People who use screen readers hear only the word 'link' and cannot tell where the link goes, and voice-control users cannot say the link name to activate it.",
    fix: "Give each link visible text, or add an aria-label, or an image with alt text, that describes where the link goes.",
    wcag: ["2.4.4", "4.1.2"]
  },
  "nested-interactive": {
    scope: "elements",
    what: "Some interactive controls contain other interactive controls, such as a button inside a link",
    who: "People who use screen readers or the keyboard may not be able to reach or activate the inner control, because assistive technology often announces only the outer one.",
    fix: "Remove the inner control, or restructure the markup so that each link, button, or field sits on its own and none is nested inside another.",
    wcag: ["4.1.2"]
  },
  "color-contrast": {
    scope: "elements",
    what: "Some text does not have enough contrast with its background",
    who: "People with low vision or colour-vision differences, and anyone reading in bright light, may not be able to read the text.",
    fix: "Darken the text or lighten the background until the contrast ratio is at least 4.5:1 (3:1 for large text).",
    wcag: ["1.4.3"]
  },
  "image-alt": {
    scope: "elements",
    what: "Some images have no alternative text",
    who: "People who use screen readers get no description of the image, so any information it carries is lost to them.",
    fix: "Add an alt attribute that describes the image purpose, or use an empty alt=\"\" when the image is purely decorative.",
    wcag: ["1.1.1"]
  },
  "button-name": {
    scope: "elements",
    what: "Some buttons have no text that a screen reader can announce",
    who: "People who use screen readers hear only the word 'button' and cannot tell what the button does, and voice-control users cannot say the button name.",
    fix: "Give each button visible text, or add an aria-label or aria-labelledby that describes the action the button performs.",
    wcag: ["4.1.2"]
  },
  "label": {
    scope: "elements",
    what: "Some form fields have no label",
    who: "People who use screen readers cannot tell what to enter in the field, and people using voice control or a small click target cannot select the field by its name.",
    fix: "Connect a visible label element to each field with matching for and id attributes, or add an aria-label when no visible label fits the design.",
    wcag: ["1.3.1", "4.1.2"]
  },
  "select-name": {
    scope: "elements",
    what: "Some select (drop-down) elements have no accessible name",
    who: "People who use screen readers hear only 'combo box' and cannot tell what the choice is for, and voice-control users cannot say the field name.",
    fix: "Connect a visible label element to each select with matching for and id attributes, or add an aria-label that describes the choice.",
    wcag: ["4.1.2"]
  },
  "target-size": {
    scope: "elements",
    what: "Some touch targets are too small or too close to other targets",
    who: "People with hand tremors, limited dexterity, or large fingers, and anyone using a touch screen, may tap the wrong control or miss it entirely.",
    fix: "Make each interactive element at least 24 by 24 CSS pixels, or add spacing around smaller ones so that a 24 pixel circle centred on each does not overlap a neighbouring target.",
    wcag: ["2.5.8"]
  },
  "heading-order": {
    scope: "elements",
    what: "Some headings skip a level, such as an h2 followed directly by an h4",
    who: "People who use screen readers rely on heading levels to understand how the page is organised, and skipped levels make the structure confusing.",
    fix: "Change the heading elements so that levels go down one step at a time (h1, then h2, then h3), and use CSS rather than heading levels to control size.",
    wcag: ["1.3.1"]
  },
  "empty-heading": {
    scope: "elements",
    what: "Some headings have no text",
    who: "People who use screen readers hear a heading with nothing in it, which is confusing, and the heading appears in their page outline with no name.",
    fix: "Add meaningful text to each heading, or remove the heading element when the heading is not needed.",
    wcag: ["2.4.6"]
  },
  "page-has-heading-one": {
    scope: "page",
    what: "The page has no level-one heading (h1)",
    who: "People who use screen readers use the h1 to find out what the page is about and to jump to the main content.",
    fix: "Add one h1 element near the start of the main content that names the page topic.",
    wcag: ["1.3.1"]
  },
  "region": {
    scope: "elements",
    what: "Some page content is not inside a landmark region",
    who: "People who use screen readers move between landmarks such as header, navigation, and main, and content outside any landmark is easy to miss.",
    fix: "Wrap the content in the right landmark element (header, nav, main, or footer), or give a generic container a suitable role and aria-label.",
    wcag: ["1.3.1"]
  },
  "landmark-one-main": {
    scope: "page",
    what: "The page does not have exactly one main landmark",
    who: "People who use screen readers use the main landmark to skip straight to the page content.",
    fix: "Wrap the primary content of the page in a single main element and remove any extra main elements.",
    wcag: ["1.3.1"]
  },
  "landmark-unique": {
    scope: "elements",
    what: "Some landmarks share the same role and name as another landmark",
    who: "People who use screen readers cannot tell the landmarks apart when two navigation areas, for example, are both announced as 'navigation'.",
    fix: "Give each landmark of the same type a different aria-label, such as 'Primary' and 'Footer' for two nav elements.",
    wcag: ["1.3.1"]
  },
  "bypass": {
    scope: "page",
    what: "The page has no way to skip repeated blocks of content",
    who: "People who use the keyboard or a screen reader must move through the whole navigation on every page before they reach the content.",
    fix: "Add a skip link as the first focusable element that jumps to the main content, or add landmarks and headings that let people jump past the repeated blocks.",
    wcag: ["2.4.1"]
  },
  "document-title": {
    scope: "page",
    what: "The page has no title element, or the title is empty",
    who: "People who use screen readers hear the page title first, and everyone relies on the title to tell browser tabs and history entries apart.",
    fix: "Add a title element inside head that briefly describes the page.",
    wcag: ["2.4.2"]
  },
  "html-has-lang": {
    scope: "page",
    what: "The html element has no lang attribute",
    who: "People who use screen readers may hear the page read with the wrong pronunciation, because the reader cannot tell which language to use.",
    fix: "Add a lang attribute to the html element that names the page language, for example lang=\"en\".",
    wcag: ["3.1.1"]
  },
  "html-lang-valid": {
    scope: "page",
    what: "The html element has a lang attribute with a value that is not valid",
    who: "People who use screen readers may hear the page read with the wrong pronunciation, because the reader cannot match the language code.",
    fix: "Change the lang attribute on the html element to a valid language code, for example lang=\"en\" or lang=\"en-NZ\".",
    wcag: ["3.1.1"]
  },
  "aria-allowed-attr": {
    scope: "elements",
    what: "Some elements use ARIA attributes that are not allowed for their role",
    who: "People who use screen readers may hear wrong or missing information about the element, because assistive technology ignores or misreads the attribute.",
    fix: "Remove each ARIA attribute that is not supported by the element role, or change the role to one that supports the attribute.",
    wcag: ["4.1.2"]
  },
  "aria-required-children": {
    scope: "elements",
    what: "Some elements with an ARIA role are missing the child elements that the role requires",
    who: "People who use screen readers may hear an incomplete or confusing structure, such as a list with no items.",
    fix: "Add the required child roles inside the element, for example listitem inside list, or option inside listbox.",
    wcag: ["1.3.1"]
  },
  "aria-required-parent": {
    scope: "elements",
    what: "Some elements with an ARIA role are not inside the parent element that the role requires",
    who: "People who use screen readers may hear an incomplete or confusing structure, such as a list item outside any list.",
    fix: "Place the element inside the required parent role, for example listitem inside list, or tab inside tablist.",
    wcag: ["1.3.1"]
  },
  "aria-valid-attr-value": {
    scope: "elements",
    what: "Some ARIA attributes have values that are not valid",
    who: "People who use screen readers may hear wrong or missing information, because assistive technology cannot act on an invalid value.",
    fix: "Correct each ARIA attribute value, and make sure that ids named by aria-labelledby, aria-describedby, or aria-controls exist on the page.",
    wcag: ["4.1.2"]
  },
  "aria-roles": {
    scope: "elements",
    what: "Some elements use an ARIA role that does not exist or is not valid",
    who: "People who use screen readers may hear the element described incorrectly, because assistive technology cannot recognise the role.",
    fix: "Change each role attribute to a valid ARIA role, or remove the role when a native HTML element already provides the meaning.",
    wcag: ["4.1.2"]
  },
  "aria-hidden-focus": {
    scope: "elements",
    what: "Some elements hidden with aria-hidden still contain focusable controls",
    who: "People who use the keyboard can move focus to a control that screen readers cannot announce, so they land on something that seems to be nothing.",
    fix: "Remove aria-hidden from the container, or make every control inside it unfocusable by using the disabled attribute or tabindex=\"-1\".",
    wcag: ["4.1.2"]
  },
  "duplicate-id-aria": {
    scope: "elements",
    what: "Some ids used by ARIA attributes or labels appear more than once on the page",
    who: "People who use screen readers may hear the wrong label or description, because the browser picks only the first element with that id.",
    fix: "Give every id on the page a unique value, and update each aria-labelledby, aria-describedby, or for attribute that refers to it.",
    wcag: ["4.1.2"]
  },
  "frame-title": {
    scope: "elements",
    what: "Some frames or iframes have no title",
    who: "People who use screen readers cannot tell what an embedded frame contains before they enter it.",
    fix: "Add a title attribute to each iframe or frame element that briefly describes its content.",
    wcag: ["4.1.2"]
  },
  "list": {
    scope: "elements",
    what: "Some lists contain elements other than list items",
    who: "People who use screen readers may hear the wrong number of items, or miss that the content is a list at all.",
    fix: "Make sure each ul or ol element has only li elements as direct children, and move any other markup inside an li.",
    wcag: ["1.3.1"]
  },
  "listitem": {
    scope: "elements",
    what: "Some list items are not inside a list",
    who: "People who use screen readers lose the list context, so they are not told how many items there are or where the list starts and ends.",
    fix: "Place each li element directly inside a ul or ol element, or change the element to something other than a list item.",
    wcag: ["1.3.1"]
  },
  "meta-viewport": {
    scope: "page",
    what: "The page stops people from zooming in",
    who: "People with low vision rely on pinch zoom or browser zoom to enlarge text, and blocking zoom makes the page unreadable for them.",
    fix: "Remove user-scalable=no and any maximum-scale value below 5 from the viewport meta tag.",
    wcag: ["1.4.4"]
  },
  "tabindex": {
    scope: "elements",
    what: "Some elements have a tabindex value greater than 0",
    who: "People who use the keyboard find that focus jumps in an order that does not match the visual layout, which makes the page hard to follow.",
    fix: "Change each positive tabindex to 0 or remove it, and arrange the page markup in the order that focus should follow.",
    wcag: ["2.4.3"]
  },
  "scrollable-region-focusable": {
    scope: "elements",
    what: "Some scrollable areas cannot be reached with the keyboard",
    who: "People who use only the keyboard cannot scroll the area, so they cannot read the content that sits out of view.",
    fix: "Add tabindex=\"0\" to the scrollable container, together with a role and an aria-label, or make sure it contains a focusable element.",
    wcag: ["2.1.1"]
  },
  "link-in-text-block": {
    scope: "elements",
    what: "Some links inside blocks of text can be told apart from the text only by colour",
    who: "People with colour-vision differences or low vision may not see that the text is a link.",
    fix: "Add an underline or another visible marker to each link in running text, or give the link at least 3:1 contrast against the surrounding text.",
    wcag: ["1.4.1"]
  },
  "autocomplete-valid": {
    scope: "elements",
    what: "Some form fields have an autocomplete value that is not valid",
    who: "People with memory or motor difficulties lose the help of browser autofill, and password managers may not fill the field.",
    fix: "Change each autocomplete attribute to a valid token from the HTML specification, such as email, given-name, or postal-code.",
    wcag: ["1.3.5"]
  }
};

export const FALLBACK_NOTE = "No curated explanation exists for this rule. The description and help text below come from the accessibility test engine.";
