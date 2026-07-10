function computeNodeActualValuesFromLinks(links, nodes) {
  nodes.forEach(function (n) {
    n._inActual = 0;
    n._outActual = 0;
  });
  links.forEach(function (link) {
    var av = link.actualValue != null ? link.actualValue : link.value;
    var src = typeof link.source === "number" ? nodes[link.source] : link.source;
    var tgt = typeof link.target === "number" ? nodes[link.target] : link.target;
    src._outActual += av;
    tgt._inActual += av;
  });
  nodes.forEach(function (n) {
    n.actualValue = Math.max(n._inActual, n._outActual);
    delete n._inActual;
    delete n._outActual;
  });
}

function applyCoreNodeRescale(sankey, nodes, links, options, iterations) {
  var coreNodeNames = options.coreNodeNames || [
    "Precipitation",
    "Green Water",
    "Evaporation & Return"
  ];
  var cropStage = options.cropStage != null ? +options.cropStage : 2;
  var evapLinkPx = options.evapLinkPx != null ? +options.evapLinkPx : 25;
  var greenWaterName = "Green Water";
  var precipName = "Precipitation";
  var evapName = "Evaporation & Return";
  var blueWaterName = "Blue Water";

  links.forEach(function (link) {
    link.actualValue = link.value;
  });
  computeNodeActualValuesFromLinks(links, nodes);

  function isCore(name) {
    return coreNodeNames.indexOf(name) >= 0;
  }

  function getNode(idxOrNode) {
    return typeof idxOrNode === "number" ? nodes[idxOrNode] : idxOrNode;
  }

  function linkEndpoints(link) {
    var source = getNode(link.source);
    var target = getNode(link.target);
    return { source: source, target: target };
  }

  function setProbeValues() {
    links.forEach(function (link) {
      var ep = linkEndpoints(link);
      var keepOriginal =
        (!isCore(ep.source.name) && !isCore(ep.target.name)) ||
        (ep.source.name === greenWaterName && +ep.target.stage === cropStage);
      link.value = keepOriginal ? link.actualValue : 0;
    });
  }

  function estimateKy() {
    var refNodes = nodes.filter(function (n) {
      return +n.stage === cropStage && n.value > 0 && n.dy > 0;
    });
    if (refNodes.length === 0) {
      refNodes = nodes.filter(function (n) {
        return !isCore(n.name) && n.value > 0 && n.dy > 0;
      });
    }
    if (refNodes.length === 0) {
      return null;
    }
    return refNodes[0].dy / refNodes[0].value;
  }

  function setDisplayValues(greenToEvapVal, greenWaterDisplayVal) {
    links.forEach(function (link) {
      var ep = linkEndpoints(link);
      var sn = ep.source.name;
      var tn = ep.target.name;

      if (sn === precipName && tn === greenWaterName) {
        link.value = greenWaterDisplayVal;
      } else if (sn === greenWaterName && tn === evapName) {
        link.value = greenToEvapVal;
      } else if (sn === greenWaterName && +ep.target.stage === cropStage) {
        link.value = link.actualValue;
      } else if (sn === blueWaterName && tn === evapName) {
        link.value = link.actualValue;
      } else if (sn === evapName && !isCore(tn)) {
        link.value = link.actualValue;
      } else if (isCore(sn) || isCore(tn)) {
        link.value = 0;
      } else {
        link.value = link.actualValue;
      }
    });
  }

  setProbeValues();
  sankey.layout(iterations);

  var kyProbe = estimateKy();
  if (kyProbe == null || !isFinite(kyProbe) || kyProbe <= 0) {
    links.forEach(function (link) {
      link.value = link.actualValue;
    });
    sankey.layout(iterations);
    return;
  }

  var greenToCropSum = 0;
  links.forEach(function (link) {
    var ep = linkEndpoints(link);
    if (ep.source.name === greenWaterName && +ep.target.stage === cropStage) {
      greenToCropSum += link.actualValue;
    }
  });

  var greenToEvapDisplay = evapLinkPx / kyProbe;
  var greenWaterDisplay = greenToCropSum + greenToEvapDisplay;

  setDisplayValues(greenToEvapDisplay, greenWaterDisplay);
  sankey.layout(iterations);

  var gwEvapLink = null;
  links.forEach(function (link) {
    var ep = linkEndpoints(link);
    if (ep.source.name === greenWaterName && ep.target.name === evapName) {
      gwEvapLink = link;
    }
  });

  if (gwEvapLink && gwEvapLink.dy != null) {
    var diff = Math.abs(gwEvapLink.dy - evapLinkPx);
    if (diff > 2 && gwEvapLink.dy > 0) {
      greenToEvapDisplay = greenToEvapDisplay * (evapLinkPx / gwEvapLink.dy);
      greenWaterDisplay = greenToCropSum + greenToEvapDisplay;
      setDisplayValues(greenToEvapDisplay, greenWaterDisplay);
      sankey.layout(iterations);
    }
  }

  pinRescaledCoreNodesToTopRow(nodes, links, sankey, options);
}

function getCoreNodeNames(options) {
  return options.coreNodeNames || [
    "Precipitation",
    "Green Water",
    "Evaporation & Return"
  ];
}

// Bottom of the rescale top band: must clear the annotation box, which is sized
// from max(core.dy) across ALL core nodes (Evaporation can exceed Green Water).
function getRescaleBandBottom(nodes, options) {
  var coreNames = getCoreNodeNames(options);
  var coreNodes = nodes.filter(function (n) {
    return coreNames.indexOf(n.name) >= 0;
  });
  var maxCoreDy = d3.max(coreNodes, function (n) {
    return n.dy;
  });
  if (maxCoreDy == null || !isFinite(maxCoreDy)) {
    maxCoreDy = 0;
  }
  var nodePadding = options.nodePadding != null ? +options.nodePadding : 10;
  var boxPad = options.rescaleCoreBoxPadding != null ? +options.rescaleCoreBoxPadding : 10;
  var bandGap = options.rescaleCoreBandGap != null ? +options.rescaleCoreBandGap : 15;
  // Clear the drawn box (maxY + boxPad), then add the usual gap.
  return maxCoreDy + Math.max(nodePadding, boxPad) + bandGap;
}

function pinRescaledCoreNodesToTopRow(nodes, links, sankey, options) {
  var coreNodeNames = getCoreNodeNames(options);
  var nodePadding = options.nodePadding != null ? +options.nodePadding : 10;

  function isCoreNode(n) {
    return coreNodeNames.indexOf(n.name) >= 0;
  }

  var coreNodes = nodes.filter(isCoreNode);
  if (coreNodes.length === 0) {
    return;
  }

  coreNodes.forEach(function (n) {
    n.y = 0;
  });

  var bandBottom = getRescaleBandBottom(nodes, options);

  var nodesByX = d3.nest()
    .key(function (d) {
      return d.x;
    })
    .sortKeys(d3.ascending)
    .entries(nodes);

  nodesByX.forEach(function (group) {
    var nonCore = group.values.filter(function (n) {
      return !isCoreNode(n);
    });
    nonCore.sort(function (a, b) {
      return a.y - b.y;
    });

    var y0 = bandBottom;
    nonCore.forEach(function (node) {
      node.y = y0;
      y0 += node.dy + nodePadding;
    });
  });

  sankey.relayout();
}

function pinCropStageBelowTopRow(nodes, sankey, options) {
  var cropStage = options.cropStage != null ? +options.cropStage : 2;
  var coreNodeNames = getCoreNodeNames(options);
  var nodePadding = options.nodePadding != null ? +options.nodePadding : 10;

  var coreNodes = nodes.filter(function (n) {
    return coreNodeNames.indexOf(n.name) >= 0;
  });
  if (coreNodes.length === 0) {
    return;
  }

  var bandBottom = getRescaleBandBottom(nodes, options);

  var cropNodes = nodes.filter(function (n) {
    return +n.stage === cropStage;
  });
  if (cropNodes.length === 0) {
    return;
  }

  cropNodes.sort(function (a, b) {
    return a.y - b.y;
  });

  var y0 = bandBottom;
  cropNodes.forEach(function (node) {
    node.y = y0;
    y0 += node.dy + nodePadding;
  });

  sankey.relayout();
}

// Re-stack one column so named nodes follow a fixed vertical order.
// Other columns (e.g. Crop Items) are left untouched — safe with iterations > 0.
// When rescaleCoreNodes is on, core nodes stay in the top band and the rest of
// the column (Blue Water, Import, …) starts below the rescale box.
function applyFixedNodeOrder(nodes, sankey, options) {
  var order = options.fixedNodeOrder;
  if (!order || !order.length) {
    return;
  }

  var orderIndex = {};
  order.forEach(function (name, i) {
    orderIndex[name] = i;
  });

  var fixedNodes = nodes.filter(function (n) {
    return Object.prototype.hasOwnProperty.call(orderIndex, n.name);
  });
  if (fixedNodes.length === 0) {
    return;
  }

  var colX = fixedNodes[0].x;
  var colNodes = nodes.filter(function (n) {
    return n.x === colX;
  });

  var inOrder = [];
  var rest = [];
  colNodes.forEach(function (n) {
    if (Object.prototype.hasOwnProperty.call(orderIndex, n.name)) {
      inOrder.push(n);
    } else {
      rest.push(n);
    }
  });

  inOrder.sort(function (a, b) {
    return orderIndex[a.name] - orderIndex[b.name];
  });
  rest.sort(function (a, b) {
    return a.y - b.y;
  });

  var nodePadding = options.nodePadding != null ? +options.nodePadding : 10;
  var coreNames = getCoreNodeNames(options);
  var rescaleOn = !!options.rescaleCoreNodes;

  function isCoreNode(n) {
    return coreNames.indexOf(n.name) >= 0;
  }

  var stackNodes;
  var y0;

  if (rescaleOn) {
    colNodes.filter(isCoreNode).forEach(function (n) {
      n.y = 0;
    });
    // Use global core max (Evaporation may be taller than Green Water).
    y0 = getRescaleBandBottom(nodes, options);
    stackNodes = inOrder.concat(rest).filter(function (n) {
      return !isCoreNode(n);
    });
  } else {
    y0 = d3.min(colNodes, function (n) {
      return n.y;
    });
    if (y0 == null || !isFinite(y0)) {
      y0 = 0;
    }
    stackNodes = inOrder.concat(rest);
  }

  stackNodes.forEach(function (node) {
    node.y = y0;
    y0 += node.dy + nodePadding;
  });

  sankey.relayout();
}

function isRescaledCoreNode(node, options) {
  return options.rescaleCoreNodes &&
    getCoreNodeNames(options).indexOf(node.name) >= 0;
}

function isRescaledCoreLink(link, options) {
  if (!options.rescaleCoreNodes) {
    return false;
  }
  var source = typeof link.source === "number" ? null : link.source;
  var target = typeof link.target === "number" ? null : link.target;
  if (!source || !target) {
    return false;
  }
  var sn = source.name;
  var tn = target.name;
  return (sn === "Precipitation" && tn === "Green Water") ||
    (sn === "Green Water" && tn === "Evaporation & Return");
}

function ensureRescaleHatchPattern(svgRoot, patternId) {
  var defs = svgRoot.select("defs");
  if (defs.empty()) {
    defs = svgRoot.append("defs");
  }
  if (!defs.select("#" + patternId).empty()) {
    return;
  }

  defs
    .append("pattern")
    .attr("id", patternId)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 8)
    .attr("height", 8)
    .attr("patternTransform", "rotate(45)")
    .append("line")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", 8)
    .attr("stroke", "#444")
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.55);
}

function drawRescaleCoreAnnotation(svg, nodes, sankey, options) {
  if (!options.rescaleCoreNodes) {
    return;
  }

  var coreNodeNames = getCoreNodeNames(options);

  var coreNodes = nodes.filter(function (n) {
    return coreNodeNames.indexOf(n.name) >= 0;
  });

  if (coreNodes.length === 0) {
    return;
  }

  var pad = options.rescaleCoreBoxPadding != null ? +options.rescaleCoreBoxPadding : 10;
  var labelOffset = options.rescaleCoreLabelOffset != null ? +options.rescaleCoreLabelOffset : 14;
  var nodeWidth = sankey.nodeWidth();
  var labelText = options.rescaleCoreLabel || "Rescaled nodes";
  var fontSize = options.fontSize || 14;

  var minX = d3.min(coreNodes, function (n) {
    return n.x;
  });
  var maxX = d3.max(coreNodes, function (n) {
    return n.x + nodeWidth;
  });
  var evapName = "Evaporation & Return";
  var evapNode = coreNodes.find(function (n) {
    return n.name === evapName;
  });
  if (evapNode) {
    var labelStartX = evapNode.x + nodeWidth + 6;
    var estimatedLabelWidth = evapName.length * fontSize * 0.55;
    maxX = Math.max(maxX, labelStartX + estimatedLabelWidth);
  }
  var minY = d3.min(coreNodes, function (n) {
    return n.y;
  });
  var maxY = d3.max(coreNodes, function (n) {
    return n.y + n.dy;
  });

  var boxX = minX - pad;
  var boxY = minY - pad;
  var boxW = maxX - minX + 2 * pad;
  var boxH = maxY - minY + 2 * pad;
  var labelX = boxX - labelOffset;
  var labelY = boxY + boxH / 2;

  var g = svg
    .append("g")
    .attr("class", "rescale-core-annotation")
    .style("pointer-events", "none");

  g.append("rect")
    .attr("class", "rescale-core-box")
    .attr("x", boxX)
    .attr("y", boxY)
    .attr("width", boxW)
    .attr("height", boxH)
    .attr("fill", "none")
    .attr("stroke", "#080808")
    .attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "6,4")
    .attr("rx", 4)
    .attr("ry", 4);

  g.append("text")
    .attr("class", "rescale-core-label")
    .attr("x", labelX)
    .attr("y", labelY)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("transform", "rotate(-90 " + labelX + " " + labelY + ")")
    .text(labelText)
    .style("font-size", fontSize + "px")
    .style("font-family", options.fontFamily ? options.fontFamily : "inherit")
    .style("fill", "#555")
    .style("font-weight", "600");
}

function tooltipValue(d) {
  return d.actualValue != null ? d.actualValue : d.value;
}

HTMLWidgets.widget({

    name: "sankeyNetwork",

    type: "output",

    initialize: function(el, width, height) {
        d3.select(el).append("div")
            .attr("id", 'append_scale')
            .style("display", "flex")
            .style("align-items", "center");


        d3.select(el).append("svg")
            .style("width", "100%")
            .style("height", "100%");

        return {
          sankey: d3.sankey(),
          x: null
        };
    },

    resize: function (el, width, height, instance) {
        // with flexdashboard and slides
        //   sankey might be hidden so height and width 0
        //   in this instance re-render on resize
        if (d3.min(instance.sankey.size()) <= 0) {
          this.renderValue(el, instance.x, instance);
        }
    },

    renderValue: function (el, x, instance) {
        // save the x in our instance (for calling back from resize)
        instance.x = x;

        // alias sankey and options
        var sankey = instance.sankey;
        var options = x.options;

        // convert links and nodes data frames to d3 friendly format
        var links = HTMLWidgets.dataframeToD3(x.links);
        var nodes = HTMLWidgets.dataframeToD3(x.nodes);
        var stage_names = HTMLWidgets.dataframeToD3(x.options.stage_names);

        // margin handling
        //   set our default margin to be 20
        //   will override with x.options.margin if provided
        var margin = { top: 20, right: 20, bottom: 20, left: 20 };

        //   go through each key of x.options.margin
        //   use this value if provided from the R side
        Object.keys(x.options.margin).map(function (ky) {
          if (x.options.margin[ky] !== null) {
            margin[ky] = x.options.margin[ky];
          }
          // set the margin on the svg with css style
          // commenting this out since not correct
          // s.style(["margin",ky].join("-"), margin[ky]);
        });

        margin.top = 40;

        // get the width and height
        var width = el.getBoundingClientRect().width - margin.right - margin.left;
        var height = el.getBoundingClientRect().height - margin.top - margin.bottom;

        var color = eval(options.colourScale);
        var node_to_zoom = x.options.zoomable_nodes;
        var color_node = function color_node(d) {
          if (d.group) {
            return color(d.group); // <--- deleted .replace(...) // (d.group.replace(/ .*/, ""));
          } else {
            return "#cccccc";
          }
        };

        var color_link = function color_link(d) {
          if (d.group) {
            return color(d.group); // <--- deleted .replace(...) // (d.group.replace(/ .*/, ""));
          } else {
            return "#000000";
          }
        };

        var opacity_link = function opacity_link(d) {
          if (d.group) {
            return 0.5;
          } else {
            return 0.2;
          }
        };

        var formatNumber = d3.format(",.0f"),
        format = function (d) {
            // if (typeof d === "string") return d;
            return formatNumber(d);
        };

        // create d3 sankey layout
        sankey
            .nodes(nodes)
            .links(links)
            .size([width, 600]) // 600 need to be fixed
            .nodeWidth(options.nodeWidth)
            .nodePadding(options.nodePadding)
            .sinksRight(options.sinksRight)
            .pinToTopCore(options.rescaleCoreNodes ? false : options.pinToTopCore);

        if (options.rescaleCoreNodes) {
          applyCoreNodeRescale(sankey, nodes, links, options, options.iterations);
          applyFixedNodeOrder(nodes, sankey, options);
        } else {
          sankey.layout(options.iterations);
          applyFixedNodeOrder(nodes, sankey, options);
          if (options.pinCropStageBelowTopRow) {
            pinCropStageBelowTopRow(nodes, sankey, options);
          }
        }

        // // ---- Pin columns to the top (easy approach) ----
        // if (options.pinToTop === undefined || options.pinToTop) {
        //   var groupsByX = d3.nest()
        //     .key(function (d) { return d.x; })
        //     .entries(nodes);

        //   groupsByX.forEach(function (g) {
        //     var minY = d3.min(g.values, function (n) { return n.y; });
        //     g.values.forEach(function (n) { n.y -= minY; });
        //   });

        //   sankey.relayout();
        // }

        // remove previously added scale
        const scale_div = document.getElementById("append_scale");
        scale_div.innerHTML = "";

        // select the svg element and remove existing children
        d3.select(el).select("svg").selectAll("*").remove();

        // remove any previously set viewBox attribute
        d3.select(el).select("svg").attr("viewBox", null);

        var svgRoot = d3.select(el).select("svg");
        var hatchPatternId = "rescale-hatch-" + String(el.id || "sankey").replace(/\s+/g, "-");
        if (options.rescaleCoreNodes) {
          ensureRescaleHatchPattern(svgRoot, hatchPatternId);
        }

        // append g for our container to transform by margin
        var svg = svgRoot
          .append("g")
          .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        drawRescaleCoreAnnotation(svg, nodes, sankey, options);

        // draw path
        var path = sankey.link();

        // draw links
        var link = svg
          .selectAll(".link")
          .data(links)
          .enter()
          .append("path")
          .attr("class", "link")
          .attr("d", path)
          .style("stroke-width", function (d) {
            return Math.max(1, d.dy);
          })
          .style("fill", "none")
          .style("stroke", color_link)
          .style("stroke-opacity", opacity_link)
          .sort(function (a, b) {
            return b.dy - a.dy;
          })
          .on("mouseover", function (d) {
            d3.select(this).style("stroke-opacity", function (d) {
              return opacity_link(d) + 0.3;
            });
          })
          .on("mouseout", function (d) {
                d3.select(this).style("stroke-opacity", opacity_link);
          });

        // add backwards class to cycles
        link.classed("backwards", function (d) {
          return d.target.x < d.source.x;
        });

        svg
          .selectAll(".link.backwards")
          .style("stroke-dasharray", "9,1")
          .style("stroke", "#402");

        if (options.rescaleCoreNodes) {
          link
            .filter(function (d) {
              return isRescaledCoreLink(d, options);
            })
            .classed("rescale-core-link", true)
            .style("stroke-dasharray", "6,4");
        }

        // draw nodes
        var node = svg
          .selectAll(".node")
          .data(nodes)
          .enter()
          .append("g")
          .attr("class", "node")
          .attr("transform", function (d) {
            return "translate(" + d.x + "," + d.y + ")";
          })
          .on("mouseover", null)
          // .call(d3.drag()
          // .subject(function(d) { return d; })
          // .on("start", function() { this.parentNode.appendChild(this); })
          // .on("drag", dragmove))
          .on("mouseover", function (d) {
            link
              .filter(function (d1, i) {
                return d.targetLinks.includes(d1) | d.sourceLinks.includes(d1);
              })
              .style("stroke-opacity", function (d) {
                return opacity_link(d) + 0.3;
              });
          })
          .on("mouseout", function (d) {
            link
              .filter(function (d1, i) {
                return d.targetLinks.includes(d1) | d.sourceLinks.includes(d1);
              })
              .style("stroke-opacity", opacity_link);
            })
            .on("mousedown.drag", Shiny.onInputChange("node_zoom", null))
            .call(function () {
              manualLayout();
            });



        // note: u2192 is right-arrow
        link
          .append("title")
          .append("foreignObject")
          .append("xhtml:body")
          .html(function (d) {
            return (
              "<pre>" +
              d.source.name +
              " \u2192 " +
              d.target.name +
              "\n" +
              format(tooltipValue(d)) +
              " " +
              options.units +
              "</pre>"
            );
          });

        node
          .append("rect")
          .attr("class", "node-rect")
          .attr("height", function (d) {
            return d.dy;
          })
          .attr("width", sankey.nodeWidth())
          .style("fill", function (d) {
            return (d.color = color_node(d));
          })
          .style("stroke", function (d) {
            return d3.rgb(d.color).darker(2);
          })
          .style("opacity", 0.9)
          // .style("cursor", "move")
          .append("title")
          .append("foreignObject")
          .append("xhtml:body")
          .html(function (d) {
            return (
              "<pre>" +
              d.name +
              ": " +
              "<br>" +
              format(tooltipValue(d)) +
              " " +
              options.units +
              "</pre>"
            );
          });


        if (options.rescaleCoreNodes) {
          node
            .filter(function (d) {
              return isRescaledCoreNode(d, options);
            })
            .append("rect")
            .attr("class", "rescale-core-hatch")
            .attr("height", function (d) {
              return d.dy;
            })
            .attr("width", sankey.nodeWidth())
            .attr("fill", "url(#" + hatchPatternId + ")")
            .style("pointer-events", "none");
        }



        d3.select(el).selectAll(".node-rect")
        .on("click", function (d) {
          if (node_to_zoom.includes(d.name)) {
            d3.select(this).style("stroke-width", "6");
            Shiny.setInputValue("node_zoom", d.name, { priority: "event" });

          }
        });
        //Add cursor to nodes with zoom
        d3.select(el)
          .selectAll(".node-rect")
          .filter(function (d, i) { return node_to_zoom.indexOf(d.name) >= 0; }) //ADD LIST OF ZOOM NODES
          .style("cursor", "pointer")
          .style("stroke-width", "4");

        node
          .append("text")
          .attr("x", -6)
          .attr("y", function (d) {
            return d.dy / 2;
          })
          .attr("dy", ".35em")
          .attr("text-anchor", "end")
          .attr("transform", null)
          .text(function (d) {
            return d.name;
          })
          .style("font-size", options.fontSize + "px")
          .style("font-family", options.fontFamily ? options.fontFamily : "inherit")
          .filter(function (d) {
            return d.x < width / 2 || !options.sinksRight;
          })
          .attr("x", 6 + sankey.nodeWidth())
          .attr("text-anchor", "start");

        // adjust viewBox to fit the bounds of our tree
        var s = d3.select(svg.node().parentNode);

        s.attr(
          "viewBox",
          [
            d3.min(
              s
                .selectAll("g")
                .nodes()
                .map(function (d) {
                  return d.getBoundingClientRect().left;
                })
              ) -
              s.node().getBoundingClientRect().left -
              margin.right,
              d3.min(
                s
                  .selectAll("g")
                  .nodes()
                  .map(function (d) {
                    return d.getBoundingClientRect().top;
                })
              ) -
              s.node().getBoundingClientRect().top -
              margin.top,
              d3.max(
                s
                  .selectAll("g")
                  .nodes()
                  .map(function (d) {
                    return d.getBoundingClientRect().right;
                })
              ) -
              d3.min(
                s
                  .selectAll("g")
                  .nodes()
                  .map(function (d) {
                    return d.getBoundingClientRect().left;
                })
              ) +
              margin.left +
              margin.right,
              d3.max(
                s
                  .selectAll("g")
                  .nodes()
                  .map(function (d) {
                    return d.getBoundingClientRect().bottom;
                })
              ) -
              d3.min(
                s
                  .selectAll("g")
                  .nodes()
                  .map(function (d) {
                    return d.getBoundingClientRect().top;
                })
              ) +
              margin.top +
              margin.bottom
            ].join(",")
          );


        // function dragmove(d) {
        //     d3.select(this).attr("transform", "translate(" + d.x + "," +
        //     (d.y = Math.max(0, Math.min(height - d.dy, d3.event.y))) + ")");
        //     sankey.relayout();
        //     link.attr("d", path);
        // }

        function manualLayout() {
          padding = 0;
          for (j = 0; j < nodes.length; j++) {
            pickNode = d3.selectAll(".node")._groups[0][j];
            d = nodes[j];

          }

          sankey.relayout();
          link.attr("d", path);
        }

        //--------------------------------------------------------------------------
        // LEGEND

        sankey_graph = document.getElementById("append_scale");

        //Calculate the scale
        let coef_refactor = 1 / window.devicePixelRatio;

        var cropStageForLegend = options.cropStage != null ? +options.cropStage : 2;
        var legendRefNode = null;
        if (options.rescaleCoreNodes) {
          legendRefNode = nodes.find(function (n) {
            return +n.stage === cropStageForLegend && n.dy > 0 &&
              (n.actualValue != null ? n.actualValue : n.value) > 0;
          });
        }
        if (!legendRefNode) {
          legendRefNode = svg.selectAll(".node rect")._groups[0][0].__data__;
        }
        let node__height = legendRefNode.dy;
        let node__value = tooltipValue(legendRefNode);

        let scale_value = 0.25 * (node__value * 100) / node__height;

        //1. Create scale
        let box_scale_div = document.createElement("div");
        box_scale_div.setAttribute("id", "scale_box");
        box_scale_div.setAttribute(
          "style",
          "margin-left: 20px; min-width: 40px; height: 25px; border: 1px solid; align-self: flex-end;"
        );

        let img_scale_div = document.createElement("div");
        img_scale_div.setAttribute("class", "img_scale");

        //1.2. Text element
        let tex_scale_div = document.createElement("div");
        tex_scale_div.setAttribute("id", "scale_text");
        tex_scale_div.setAttribute(
          "style",
          "float: left;  color: black; padding: 6px 0 7px 0; text-align: center; width: auto; height: 30px; padding: 7px; vertical-align: middle; font-size: 14px; font-weight: bold;"
        );
        let scale_text = document.createElement("p");

        scale_text.textContent =
          "25 px ~  " + format(scale_value.toFixed(0)) + " m³ of water";


      scale_text.setAttribute("style", "margin: 0px;");

      //2. Create zoom-info
      let box_zoom_div = document.createElement("div");
      box_zoom_div.setAttribute("id", "zoom_box");
      box_zoom_div.setAttribute(
        "style",
        "min-width: 40px; height: 25px; border: 5px solid; align-self: flex-end;"
      );

      //2.2. Text element
      let tex_zoom_div = document.createElement("div");
      tex_zoom_div.setAttribute("id", "zoom_text");
      tex_zoom_div.setAttribute(
        "style",
        "float: left;  color: black; padding: 6px 0 7px 0; text-align: center; width: auto; height: 30px; padding: 7px; vertical-align: middle; font-weight: bold; font-size: 14px;"
      );

      let zoom_text = document.createElement("p");
      zoom_text.textContent =
        "Click on bold for zoom";
      zoom_text.setAttribute("style", "margin: 0px;");
        //2. Mouseover info
      let mouseover_zoom_div = document.createElement("div");
      mouseover_zoom_div.setAttribute("id", "mouseover_box");
      mouseover_zoom_div.setAttribute(
        "style",
        "min-width: 40px; height: 25px; background: grey; align-self: flex-end;"
      );

      //2.2. Text element
      let tex_mouseover_div = document.createElement("div");
      tex_mouseover_div.setAttribute("id", "mouseover_text");
      tex_mouseover_div.setAttribute(
        "style",
        "float: left;  color: black; padding: 6px 0 7px 0; text-align: center; width: auto; height: 30px; padding: 7px; vertical-align: middle; font-weight: bold; font-size: 14px;"
      );

      let mouseover_text = document.createElement("p");
      mouseover_text.textContent =
        "Mouseover for values";
      mouseover_text.setAttribute("style", "margin: 0px;");

      //Append blocks
      sankey_graph.append(box_scale_div);
      sankey_graph.append(img_scale_div);
      sankey_graph.append(tex_scale_div);
      sankey_graph.append(box_zoom_div);
      sankey_graph.append(tex_zoom_div);
      sankey_graph.append(mouseover_zoom_div);
      sankey_graph.append(tex_mouseover_div);
      tex_scale_div.append(scale_text);
      tex_zoom_div.append(zoom_text);

      tex_mouseover_div.append(mouseover_text);
      if (stage_names.length > 0)
        {
          var x_coord = nodes.map(d => d.x);
        x_coord = [...new Set(x_coord)].sort((a, b) => a - b);
        var stageLabelY = options.rescaleCoreNodes ? -26 : -10;

        for (i = 0; i < x_coord.length; i++) {

          if (i == 0) {

            svg
              .append("text")
              .attr("transform", null)
              .attr("y", stageLabelY)
              .attr("text-anchor", "start")
              .attr("x", x_coord[i]) // shift along the x-axis
              .attr("style", "color: black; font-weight: bold; font-size: 14px;")
              // .text("text");
              .text(stage_names[i]['name']);
          }
          else {
            svg
              .append("text")
              .attr("transform", null)
              .attr("y", stageLabelY)
              .attr("text-anchor", "middle")
              .attr("x", x_coord[i] + options.nodeWidth / 2) // shift along the x-axis
              .attr("style", "color: black; font-weight: bold; font-size: 14px;")
              // .text("text");
              .text(stage_names[i]['name']);
          }

        }

        }

    },
});
