const express = require('express');
const router = express.Router();

const puppeteer = require('puppeteer-core');

const clipRecipe = async clipUrl => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `ws://${process.env.BROWSERLESS_HOST}:${process.env.BROWSERLESS_PORT}`
  });

  const page = await browser.newPage();

  try {
    await page.goto(clipUrl, {
      waitUntil: "networkidle2",
      timeout: 15000
    });
  } catch(err) {
    err.status = 400;
    throw err;
  }

  const recipeData = await page.evaluate(() => {
    const getClassRegExp = (classname, multiple) => {
      modifiers = multiple ? 'gi' : 'i';
      return new RegExp(`class="((\\w|\\s|-)*${classname}(\\w|\\s|-)*)"`, modifiers);
    }

    const softMatchElementsByClass = classname => {
      const matches = document.body.innerHTML.match(getClassRegExp(classname, true));

      if (!matches) return [];
      return matches.reduce((acc, match) => [
        ...acc,
        ...(document.getElementsByClassName(match.match(getClassRegExp(classname, false))[1]) || [])
      ], []);
    }

    const grabLongestMatchByClasses = (preferredClassNames, fuzzyClassNames) => {
      const exactMatches = preferredClassNames.reduce((acc, className) => [...acc, ...document.getElementsByClassName(className)], [])
      const fuzzyMatches = fuzzyClassNames.reduce((acc, className) => [...acc, ...softMatchElementsByClass(className)], [])

      return (exactMatches.length > 0 ? exactMatches : fuzzyMatches)
        .map(element => element.innerText.trim())
        .reduce((max, match) => match.length > max.length ? match : max, '')
    }

    const grabClosestImageByClasses = (preferredClassNames, fuzzyClassNames) => {
      const exactMatches = preferredClassNames.reduce((acc, className) => [...acc, ...document.getElementsByClassName(className)], [])
      const fuzzyMatches = fuzzyClassNames.reduce((acc, className) => [...acc, ...softMatchElementsByClass(className)], [])

      return (exactMatches.length > 0 ? exactMatches : fuzzyMatches)
        .reduce((acc, element) => [...acc, ...element.querySelectorAll('img')], [])
        .filter(element => element.src)
        .reduce((max, element) => (element.offsetHeight * element.offsetWidth) > (max ? (max.offsetHeight * max.offsetWidth) : 0) ? element : max, null)
    }

    const cleanKnownWords = textBlock => {
      const generalBadWords = ['instructions', 'directions', 'procedure', 'you will need', 'ingredients', 'total time', 'active time', 'prep time', 'time', 'yield', 'servings', 'notes'];
      const allRecipesBadWords = ['decrease serving', 'increase serving', 'adjust', 'the ingredient list now reflects the servings specified', 'footnotes'];
      const tastyRecipesBadWords = ['scale 1x2x3x'];

      const badWords = [...generalBadWords, ...allRecipesBadWords, ...tastyRecipesBadWords].join('|');

      let filteredResult = textBlock.split('\n')
        .map(line => line.trim())
        .filter(line => line.length !== 0) // Remove whitespace-only lines
        .filter(line => badWords.indexOf(line.toLowerCase()) === -1) // Remove words that will be a duplicate of field names
        .filter(line => !line.match(/^(step *)?\d+:?$/i)) // Remove digits and steps that sit on their own lines
        .map(line => line.replace(/^(total time|prep time|active time|yield|servings):? ?/i, '')) // Remove direct field names for meta
        .map(line => line.trim())
        .map(line => line.match(/^([A-Z] *)+:? *$/) ? `[${capitalizeEachWord(line.toLowerCase()).replace(':', '')}]` : line)
        .join('\n');

      return filteredResult;
    }

    const capitalizeEachWord = textBlock => {
      return textBlock.split(' ').map(word => `${word.charAt(0).toUpperCase()}${word.substring(1)}`).join(' ');
    }

    const formatFuncs = {
      imageURL: val => val.trim(),
      title: val => capitalizeEachWord(val.trim().toLowerCase()),
      description: val => val.length > 300 ? '' : cleanKnownWords(val),
      source: val => val.trim(),
      yield: val => val.length > 30 ? '' : capitalizeEachWord(cleanKnownWords(val).trim().toLowerCase()),
      activeTime: val => val.length > 30 ? '' : capitalizeEachWord(cleanKnownWords(val).trim().toLowerCase()),
      totalTime: val => val.length > 30 ? '' : capitalizeEachWord(cleanKnownWords(val).trim().toLowerCase()),
      ingredients: val => cleanKnownWords(val),
      instructions: val => cleanKnownWords(val),
      notes: val => cleanKnownWords(val)
    };

    const closestToRegExp = regExp => {
      return (document.body.innerText.match(regExp) || '')[0] || '';
    }

    const classMatchers = {
      imageURL: [
        [
          'wprm-recipe-image', // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
          'tasty-recipes-image', // TastyRecipes recipe embed tool - https://sallysbakingaddiction.com/quiche-recipe/
          'hero-photo', // AllRecipes - https://www.allrecipes.com/recipe/231244/asparagus-mushroom-bacon-crustless-quiche/
          'o-RecipeLead__m-RecipeMedia', // FoodNetwork - https://www.foodnetwork.com/recipes/paula-deen/spinach-and-bacon-quiche-recipe-2131172
          'recipe-lede-image', // Delish - https://www.delish.com/cooking/recipe-ideas/a25648042/crustless-quiche-recipe/
          'recipe-body', // Generic, idea from Delish - https://www.delish.com/cooking/recipe-ideas/a25648042/crustless-quiche-recipe/
          'recipe__hero', // Food52 - https://food52.com/recipes/81867-best-quiche-recipe
        ],
        [
          'recipe-image',
          'hero',
          'recipe-content', // Generic, search for largest image within any recipe content block
          'recipe-body', // Generic, search for largest image within any recipe content block
          'recipe-intro', // Generic, search for largest image within any recipe content block
          'recipe-' // Generic, search for largest image within any recipe content block
        ]
      ],
      title: [
        [
          'wprm-recipe-name', // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
          'recipe-title' // Generic
        ],
        []
      ],
      description: [
        [
          'wprm-recipe-summary' // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
        ],
        []
      ],
      yield: [
        ['yield', 'servings'],
        ['yield', 'servings']
      ],
      activeTime: [
        ['activeTime', 'active-time', 'prep-time', 'time-active', 'time-prep'],
        ['activeTime', 'active-time', 'prep-time', 'time-active', 'time-prep']
      ],
      totalTime: [
        ['totalTime', 'total-time', 'time-total'],
        ['totalTime', 'total-time', 'time-total']
      ],
      ingredients: [
        [
          'wprm-recipe-ingredients-container', // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
          'wprm-recipe-ingredients', // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
          'tasty-recipes-ingredients', // Tasty recipes embed tool - https://myheartbeets.com/paleo-tortilla-chips/
          'o-Ingredients', // FoodNetwork - https://www.foodnetwork.com/recipes/paula-deen/spinach-and-bacon-quiche-recipe-2131172
          'recipe-ingredients',
        ],
        ['ingredients']
      ],
      instructions: [
        [
          'wprm-recipe-instructions', // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
          'tasty-recipes-instructions', // Tasty recipes embed tool - https://myheartbeets.com/paleo-tortilla-chips/
          'recipe-directions__list', // AllRecipes - https://www.allrecipes.com/recipe/231244/asparagus-mushroom-bacon-crustless-quiche/
          'o-Method', // FoodNetwork - https://www.foodnetwork.com/recipes/paula-deen/spinach-and-bacon-quiche-recipe-2131172
          'instructions', // Generic
          'recipe-steps', // Generic
          'recipe-instructions', // Generic
          'directions' // Generic
        ],
        ['instructions', 'directions']
      ],
      notes: [
        [
          'notes',
          'recipe-notes',
          'recipe-footnotes',
          'recipe__tips', // King Arthur Flour - https://www.kingarthurflour.com/recipes/chocolate-cake-recipe
          'wprm-recipe-notes-container' // Wordpress recipe embed tool - https://panlasangpinoy.com/leche-flan/
        ],
        ['recipe-notes']
      ]
    }

    const getAttrIfExists = (el, attrName) => {
      if (el.attributes[attrName]) return el.attributes[attrName].value;
      return '';
    }

    const getSrcFromImage = img => {
      if (!img) return '';

      const closestSrc = getAttrIfExists(img, 'data-src') || getAttrIfExists(img, 'data-lazy-src') || img.currentSrc || img.src;
      return closestSrc || '';
    }

    const autoSnipResults = {
      imageURL: formatFuncs.imageURL(getSrcFromImage(grabClosestImageByClasses(...classMatchers.imageURL))),
      title: formatFuncs.title(grabLongestMatchByClasses(...classMatchers.title) || document.title.split(/ -|\| /)[0]),
      description: formatFuncs.description(grabLongestMatchByClasses(...classMatchers.description)),
      source: formatFuncs.source(document.title.split(/ -|\| /)[1] || window.location.hostname.split('.').reverse()[1]),
      yield: formatFuncs.yield(grabLongestMatchByClasses(...classMatchers.yield) || closestToRegExp(/(serves|servings|yield):?\s*\d+/i).replace('\n', '')),
      activeTime: formatFuncs.activeTime(grabLongestMatchByClasses(...classMatchers.activeTime) || closestToRegExp(/(active time|prep time):?\s*(\d+ (hour(s?)|hr(s?)|minute(s?)|min(s?))? ?(and)? ?)+/i).replace('\n', '')),
      totalTime: formatFuncs.totalTime(grabLongestMatchByClasses(...classMatchers.totalTime) || closestToRegExp(/(total time):?\s*(\d+ (hour(s?)|hr(s?)|minute(s?)|min(s?))? ?(and)? ?)+/i).replace('\n', '')),
      ingredients: formatFuncs.ingredients(grabLongestMatchByClasses(...classMatchers.ingredients)),
      instructions: formatFuncs.instructions(grabLongestMatchByClasses(...classMatchers.instructions)),
      notes: formatFuncs.notes(grabLongestMatchByClasses(...classMatchers.notes))
    };

    return autoSnipResults;
  });

  console.log(JSON.stringify(recipeData));
  return recipeData;
};


router.get('/', async (req, res, next) => {
  try {
    const recipeData = await clipRecipe(req.query.url);

    res.status(200).json(recipeData);
  } catch(e) {
    next(e);
  }
});

module.exports = router;
