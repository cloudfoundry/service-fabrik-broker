# Gotemplates

Go’s [`text/template`](https://golang.org/pkg/text/template) package provides a rich templating language for text templates. In addition to the constructs and functions provided by go templates, inter operator supports a few additional function

## Additional Functions

### Sprig

All the functions provided by [sprig](http://masterminds.github.io/sprig/) library(v2.22) is supported by interoperator.


### Custom Functions
```
b64enc          Returns the base64 encoded output of its argument string

b64dec          Takes a base64 encoded string and returns the base64 decoded output
                of its argument. Will return an error in case the input cannot be
                decoded in base64.

unmarshalJSON   Takes a stringified JSOn as input converts it to a map of type
                map[string]interface{}. Returns an error if it fails to convert.

marshalJSON     The function encodes an item into a JSON string. If the item
                cannot be converted to JSON the function will return an error.
                The input argument is expected to be of type map[string]interface{}
```

### Debugging
For validating gotemplates we have a small go [program](https://github.com/vivekzhere/gotemplate-test) which renders a go template and prints the output. You can use it to try out go templates.