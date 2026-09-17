const portraitContainer = document.getElementById("portrait-container");

// fetch the SVG as text
fetch("assets/portrait.svg")
    .then(function (response) {
        if (!response.ok) {
            throw new Error("Could not load portrait.svg (status " + response.status + ")");
        }
        return response.text();
    })
    .then(function (svgText) {
        // drop the SVG markup straight into the container
        // keeps viewBox, IDs, and geometry
        portraitContainer.innerHTML = svgText;

        // reference to the inserted SVG
        const svgElement = portraitContainer.querySelector("svg");

        // same sizing as the old <img>
        svgElement.style.height = "78vh";
        svgElement.style.width = "auto";
        svgElement.style.maxWidth = "90vw";
        svgElement.style.display = "block";

        // collect every slot element
        const slotElements = svgElement.querySelectorAll('[id^="slot-"]');

        console.log("Portrait SVG loaded");
        console.log(svgElement);
        console.log(slotElements.length);
    })
    .catch(function (error) {
        console.error("Error loading portrait SVG:", error);
    });
