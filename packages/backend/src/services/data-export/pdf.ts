// PDFMake must be imported via import xyz = require('xyz') because pdfmake
// uses the `export =` syntax
// See TypeScript documentation here: https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require
import pdfmake = require("pdfmake");
import { Writable } from "stream";
import {
  parseIngredients,
  parseInstructions,
  parseNotes,
} from "@recipesage/util/shared";
import * as sanitizeHtml from "sanitize-html";
import { fetchURL } from "@recipesage/util/server/general";
import * as fs from "fs";
import { Image, Recipe } from "@prisma/client";
import { Content, Margins, TDocumentDefinitions } from "pdfmake/interfaces";
import * as path from "path";

export interface ExportOptions {
  includeImages?: boolean;
  includeImageUrls?: boolean;
}

const parsedToSchema = (
  parsedItems: { content: string; isHeader: boolean }[],
  includeMargin: boolean,
): {
  text: string;
  bold: boolean;
  margin: Margins | undefined;
}[] => {
  return parsedItems.map((item) => ({
    text: item.content,
    bold: item.isHeader,
    margin: includeMargin ? [0, 0, 0, 5] : undefined,
  }));
};

const recipeToSchema = async (
  recipe: Recipe & { images: Image[] },
  options?: ExportOptions,
): Promise<Content> => {
  const schema: Content[] = [];

  const headerContent: Content[] = [];

  headerContent.push({
    text: recipe.title || "",
    fontSize: 16,
  });

  const showTagLine =
    recipe.source || recipe.activeTime || recipe.totalTime || recipe.yield;
  if (showTagLine) {
    const tagline: [string, string][] = [];

    if (recipe.source) tagline.push(["Source:", recipe.source]);
    if (recipe.activeTime) tagline.push(["Active time:", recipe.activeTime]);
    if (recipe.totalTime) tagline.push(["Total time:", recipe.totalTime]);
    if (recipe.yield) tagline.push(["Yield:", recipe.yield]);

    const taglineSchema = tagline.reduce((acc, item) => {
      return [
        ...acc,
        {
          text: item[0] + " ",
          bold: true,
        },
        {
          text: item[1] + "  ",
        },
      ];
    }, [] as Content[]);

    headerContent.push({
      text: taglineSchema,
      margin: [0, 10, 0, 10], // left top right bottom
    });
  }

  if (recipe.description) {
    headerContent.push({
      text: recipe.description,
      margin: [0, showTagLine ? 0 : 10, 0, 10], // left top right bottom
    });
  }

  const imageUrl = recipe.images[0]?.location;
  if (imageUrl && options?.includeImages) {
    try {
      let buffer: Buffer;
      if (process.env.NODE_ENV === "selfhost" && imageUrl.startsWith("/")) {
        buffer = await fs.promises.readFile(imageUrl);
      } else {
        const response = await fetchURL(imageUrl);
        buffer = await response.buffer();
      }

      schema.push({
        columns: [
          {
            width: 100,
            image: `data:image/jpeg;base64,${buffer.toString("base64")}`,
            fit: [100, 100],
          },
          {
            width: "auto",
            stack: headerContent,
            margin: [10, 10, 0, 0],
          },
        ],
        margin: [0, 0, 0, 10],
      });
    } catch (e) {
      schema.push(...headerContent);
    }
  } else {
    schema.push(...headerContent);
  }

  const parsedInstructions = parseInstructions(
    sanitizeHtml(recipe.instructions || ""),
  );
  const parsedIngredients = parseIngredients(
    sanitizeHtml(recipe.ingredients || ""),
    1,
    false,
  );
  const parsedNotes = parseNotes(sanitizeHtml(recipe.notes || ""));
  if (recipe.ingredients && recipe.instructions) {
    schema.push({
      columns: [
        {
          width: 180,
          stack: parsedToSchema(parsedIngredients, true),
        },
        {
          width: "auto",
          stack: parsedToSchema(parsedInstructions, true),
        },
      ],
    });
  } else if (recipe.ingredients) {
    schema.push({
      text: parsedToSchema(parsedIngredients, true),
    });
  } else if (recipe.instructions) {
    schema.push({
      text: parsedToSchema(parsedInstructions, true),
    });
  }

  if (recipe.notes) {
    const header = {
      text: "Notes:",
      margin: [0, 10, 0, 5] satisfies Margins, // left top right bottom
      bold: true,
    };
    schema.push(header);
    schema.push(...parsedToSchema(parsedNotes, false));
  }
  if (recipe.url) {
    schema.push({
      text: [
        {
          text: "Source URL: ",
          bold: true,
        },
        {
          text: recipe.url,
          link: recipe.url,
        },
      ],
      margin: [0, 10, 0, 0],
    });
  }
  if (options?.includeImageUrls && imageUrl) {
    schema.push({
      text: [
        {
          text: "Image URL: ",
          bold: true,
        },
        {
          text: imageUrl,
          link: imageUrl,
        },
      ],
      margin: [0, 10, 0, 0],
    });
  }

  return schema;
};

// TODO: Support multi language
export const exportToPDF = async (
  recipes: (Recipe & { images: Image[] })[],
  writeStream: Writable,
  options?: ExportOptions,
): Promise<void> => {
  const fonts = {
    NotoSans: {
      normal: path.join(
        __dirname,
        "../../../fonts/Noto_Sans/NotoSans-Regular.ttf",
      ),
      bold: path.join(__dirname, "../../../fonts/Noto_Sans/NotoSans-Bold.ttf"),
      italics: path.join(
        __dirname,
        "../../../fonts/Noto_Sans/NotoSans-Italic.ttf",
      ),
      bolditalics: path.join(
        __dirname,
        "../../../fonts/Noto_Sans/NotoSans-BoldItalic.ttf",
      ),
    },
  };

  const content: Content[] = [];
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];

    content.push(await recipeToSchema(recipe, options));

    if (i !== recipes.length - 1) {
      content.push({
        text: "",
        pageBreak: "after",
      });
    }
  }

  const docDefinition: TDocumentDefinitions = {
    content,
    defaultStyle: {
      font: "NotoSans",
      fontSize: 10,
      lineHeight: 1.2,
    },
  };

  const printer = new pdfmake(fonts);
  const doc = printer.createPdfKitDocument(docDefinition);
  doc.pipe(writeStream);
  doc.end();
};
