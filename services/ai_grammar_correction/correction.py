from happytransformer import HappyTextToText, TTSettings

# Initialize the model
happy_tt = HappyTextToText("T5", "vennify/t5-base-grammar-correction")

# Define the settings
args = TTSettings(num_beams=5, min_length=1)

def correct_grammar(text: str) -> str:
    result = happy_tt.generate_text(f"grammar: {text}", args=args)
    return result.text